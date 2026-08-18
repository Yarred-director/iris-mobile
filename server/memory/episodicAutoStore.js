// server/memory/episodicAutoStore.js
// Event-gated autonomous memory pipeline. The caller decides whether the exchange is important enough to persist.

import { randomUUID } from 'crypto';
import { createEmbedding } from './embeddings.js';

function parseJson(raw, fallback = null) {
  try {
    const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const match = String(raw || '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return fallback;
    try { return JSON.parse(match[0]); } catch { return fallback; }
  }
}

async function jsonResponse({ llmClient, model, prompt, maxOutputTokens = 400 }) {
  const response = await llmClient.responses.create({
    model,
    reasoning: { effort: 'none' },
    max_output_tokens: maxOutputTokens,
    input: [{ role: 'user', content: prompt }],
  });
  return parseJson(response.output_text, null);
}

export async function autoStoreEpisodicMemoryHybrid({
  supabase,
  userId,
  sceneKey = 'global',
  sceneContext,
  userText,
  llmReply = null,
  llmClient,
  model,
}) {
  const textToStore = llmReply || userText;
  if (!textToStore || !textToStore.trim()) return;

  // memoryPolicy already gates this path. For legacy direct callers, judge user-only writes cheaply.
  let decision = { should_store: true, importance: 0.8 };
  if (!llmReply) {
    try {
      decision = await jsonResponse({
        llmClient,
        model,
        maxOutputTokens: 120,
        prompt: `You are a memory judge for Iris, an AI companion.
Store only durable personal facts, meaningful preferences, emotions/life events, important roleplay/shared experiences, or context likely to matter later.
Do not store greetings, filler, one-word acknowledgements or generic questions.
User message: ${JSON.stringify(String(userText || '').slice(0, 1200))}
Return JSON only: {"should_store":true|false,"importance":0.1-1.0}`,
      }) || { should_store: false, importance: 0.5 };
    } catch (e) {
      console.log('[MEMORY_JUDGE_ERROR]', e?.message);
      decision = { should_store: false, importance: 0.5 };
    }
  }
  if (!decision?.should_store) return;

  const importance = Math.max(0.1, Math.min(1, Number(decision.importance ?? 0.7)));
  const rowId = randomUUID();
  const { error: insertError } = await supabase.from('episodic_memory').insert({
    id: rowId,
    user_id: userId,
    scene_key: sceneKey,
    title: 'Pending memory',
    narrative: textToStore,
    memory_type: 'episodic',
    importance,
    memory_note: JSON.stringify({ stage: 'raw', source: llmReply ? 'exchange' : 'user' }),
  });
  if (insertError) {
    console.log('[AUTO_MEMORY_INSERT_ERROR]', insertError.message);
    return;
  }

  setImmediate(async () => {
    try {
      const enriched = await enrichMemory({ textToStore, sceneContext, llmClient, model });
      const summary = enriched?.summary || textToStore;
      const embedding = await createEmbedding(summary);
      const { error } = await supabase.from('episodic_memory').update({
        title: enriched?.title || 'Memory',
        narrative: summary,
        emotional_tags: Array.isArray(enriched?.emotional_tags) ? enriched.emotional_tags.slice(0, 6) : [],
        embedding,
        memory_revision: 2,
        memory_note: JSON.stringify({ stage: 'enriched', source: llmReply ? 'exchange' : 'user' }),
      }).eq('id', rowId);
      if (error) console.log('[AUTO_MEMORY_ENRICH_UPDATE_ERROR]', error.message);
    } catch (e) {
      console.log('[AUTO_MEMORY_ENRICH_ERROR]', e?.message);
    }

    const backgroundJobs = [
      detectAndStoreSharedExperience({ supabase, userId, sceneKey, userText, irisReply: llmReply, sceneContext, llmClient, model }),
      extractAndStoreUserProfile({ supabase, userId, userText, irisReply: llmReply, llmClient, model }),
    ];
    const results = await Promise.allSettled(backgroundJobs);
    for (const result of results) {
      if (result.status === 'rejected') console.log('[AUTO_MEMORY_BACKGROUND_ERROR]', result.reason?.message || result.reason);
    }
  });
}

async function enrichMemory({ textToStore, sceneContext, llmClient, model }) {
  return jsonResponse({
    llmClient,
    model,
    maxOutputTokens: 300,
    prompt: `Summarize this durable memory from Iris's perspective in 1-2 concise sentences. Preserve key facts, emotional meaning and relevant scene context without embellishment. Suggest a short title.
Memory: ${JSON.stringify(String(textToStore || '').slice(0, 1600))}
Scene: ${JSON.stringify(sceneContext || {})}
Return JSON only: {"title":"...","summary":"...","emotional_tags":["..."]}`,
  });
}

async function detectAndStoreSharedExperience({ supabase, userId, sceneKey, userText, irisReply, sceneContext, llmClient, model }) {
  const combinedText = [
    userText ? `User: ${userText}` : null,
    irisReply ? `Iris: ${irisReply}` : null,
  ].filter(Boolean).join('\n').slice(0, 2200);

  const result = await jsonResponse({
    llmClient,
    model,
    maxOutputTokens: 500,
    prompt: `Determine whether this exchange contains a memorable SHARED EXPERIENCE between a user and Iris: a roleplay scene they experienced together, romantic/intimate moment, significant emotional moment, or imagined visit/activity together.
Conversation:\n${combinedText}
Scene context: ${JSON.stringify({
      location: sceneContext?.place,
      country: sceneContext?.location_country,
      city: sceneContext?.location_city,
    })}
If no meaningful shared experience, return {"isExperience":false}.
If yes, return JSON only with:
{"isExperience":true,"location":string|null,"country":string|null,"city":string|null,"summary":string,"full_narrative":string|null,"actions":[],"emotional_tone":string|null,"intensity":"soft|romantic|sensual|explicit","iris_emotion":string|null,"iris_notes":string|null}`,
  });
  if (!result?.isExperience || !result?.summary) return;

  const embeddingText = [result.location, result.summary, result.actions?.join(', '), result.emotional_tone].filter(Boolean).join('. ');
  let embedding = null;
  try { embedding = await createEmbedding(embeddingText); }
  catch (e) { console.log('[SHARED_EXP_EMBEDDING_ERROR]', e?.message); }

  const { error } = await supabase.from('shared_experiences').insert({
    user_id: userId,
    scene_key: sceneKey,
    location: result.location || null,
    country: result.country || null,
    city: result.city || null,
    summary: result.summary,
    full_narrative: result.full_narrative || null,
    actions: Array.isArray(result.actions) ? result.actions : [],
    emotional_tone: result.emotional_tone || null,
    intensity: result.intensity || 'soft',
    iris_emotion: result.iris_emotion || null,
    iris_notes: result.iris_notes || null,
    importance: 0.95,
    embedding,
  });
  if (error) console.log('[SHARED_EXP_INSERT_ERROR]', error.message);
}

async function extractAndStoreUserProfile({ supabase, userId, userText, irisReply, llmClient, model }) {
  const combinedText = [
    userText ? `User: ${userText}` : null,
    irisReply ? `Iris: ${irisReply}` : null,
  ].filter(Boolean).join('\n').slice(0, 2200);

  const facts = await jsonResponse({
    llmClient,
    model,
    maxOutputTokens: 400,
    prompt: `Extract durable personal facts explicitly stated or strongly supported about the USER only, not Iris.
Useful categories: appearance, personality, hobbies, interests, preferences, dislikes, personal. Avoid transient mood unless clearly important. Do not infer sensitive/protected attributes from indirect clues.
Conversation:\n${combinedText}
Return a valid JSON array only (or []):
[{"category":"preferences","fact_key":"snake_case_key","fact_value":"value","confidence":0.6}]`,
  });
  if (!Array.isArray(facts) || !facts.length) return;

  for (const fact of facts.slice(0, 8)) {
    if (!fact?.fact_key || fact.fact_value == null || Number(fact.confidence || 0) < 0.6) continue;
    const { error } = await supabase.from('user_profile').upsert({
      user_id: userId,
      category: fact.category || 'personal',
      fact_key: String(fact.fact_key).slice(0, 120),
      fact_value: String(fact.fact_value).slice(0, 500),
      confidence: Math.min(1, Number(fact.confidence || 0.8)),
      source: 'auto',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,fact_key' });
    if (error) console.log('[USER_PROFILE_UPSERT_ERROR]', error.message);
  }
}
