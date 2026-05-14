// server/memory/episodicAutoStore.js
// Hybrid autonomous memory pipeline + USER PROFILE EXTRACTION
// - Ukladá epizodickú pamäť (čo si Iris + user hovorili)
// - Extrahuje fakty o userovi a ukladá do user_profile

import { randomUUID } from 'crypto';
import { createEmbedding } from './embeddings.js';

// ───────────────────────────────────────────────────────────
// MAIN EXPORT
// ───────────────────────────────────────────────────────────
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

  // ── STEP 1: LLM rozhodne či pamäť stojí za uloženie ───────────────
  let decision = { should_store: true, reason: 'IRIS reply - always store', importance: 0.9 };

  if (!llmReply) {
    try {
      const judgePrompt = `You are a memory judge for an AI companion called Iris.
Decide if the following user message contains something worth remembering long-term.

Worth storing: personal facts, emotions, life events, preferences, opinions, important context.
NOT worth storing: greetings, short filler messages, one-word answers, generic questions.

User message: """${userText}"""

Respond ONLY with valid JSON:
{"should_store": true|false, "reason": "short reason", "importance": 0.1-1.0}`;

      const judgeResp = await llmClient.chat.completions.create({
        model,
        max_tokens: 100,
        temperature: 0,
        messages: [{ role: 'user', content: judgePrompt }],
      });

      const raw = judgeResp.choices?.[0]?.message?.content?.trim() || '';
      decision = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.log('[MEMORY_JUDGE_ERROR]', e?.message);
      decision = { should_store: true, importance: 0.5 };
    }
  }

  if (!decision?.should_store) return;

  const importance = decision.importance ?? 0.7;
  const rowId = randomUUID();

  // ── STEP 2: RAW insert ─────────────────────────────
  try {
    await supabase.from('episodic_memory').insert({
      id: rowId,
      user_id: userId,
      scene_key: sceneKey,
      title: 'Pending memory',
      narrative: textToStore,
      memory_type: 'episodic',
      importance,
      memory_note: JSON.stringify({ stage: 'raw', source: llmReply ? 'iris' : 'user' }),
    });
  } catch (e) {
    console.log('[AUTO_MEMORY_INSERT_ERROR]', e?.message);
    return;
  }

  // ── STEP 3: Enrich + Embedding (async, neblokuje odpoveď) ─────────────
  setImmediate(async () => {
    try {
      // Enrich — LLM vytvorí lepší summary + title
      const enrichPrompt = `Summarize this memory from the perspective of Iris, an AI companion.
Write a short narrative (2-3 sentences) capturing the key facts, emotions, and context.
Also suggest a short title (5 words max).

Memory: """${textToStore}"""
Scene: ${sceneKey}
Context: ${JSON.stringify(sceneContext || {})}

Respond ONLY with JSON:
{"title": "...", "summary": "...", "emotional_tags": ["tag1", "tag2"]}`;

      const enrichResp = await llmClient.chat.completions.create({
        model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [{ role: 'user', content: enrichPrompt }],
      });

      const enrichRaw = enrichResp.choices?.[0]?.message?.content?.trim() || '';
      const enriched = JSON.parse(enrichRaw.replace(/```json|```/g, '').trim());

      const summary = enriched.summary || textToStore;
      const title = enriched.title || 'Memory';
      const emotional_tags = enriched.emotional_tags || [];

      // Embedding
      const embedding = await createEmbedding(summary, llmClient);

      // Update záznamu
      await supabase
        .from('episodic_memory')
        .update({
          title,
          narrative: summary,
          emotional_tags,
          embedding,
          memory_revision: 2,
          memory_note: JSON.stringify({ stage: 'enriched', source: llmReply ? 'iris' : 'user' }),
        })
        .eq('id', rowId);

      console.log('[AUTO_MEMORY_ENRICHED]', rowId, llmReply ? '(IRIS REPLY)' : '(USER)');
    } catch (e) {
      console.log('[AUTO_MEMORY_ENRICH_ERROR]', e?.message);
    }

    // ── STEP 4: Extrakcia user profile faktov ───────────────────
    try {
      await extractAndStoreUserProfile({
        supabase,
        userId,
        userText,
        irisReply: llmReply,
        llmClient,
        model,
      });
    } catch (e) {
      console.log('[USER_PROFILE_EXTRACT_ERROR]', e?.message);
    }
  });
}

// ───────────────────────────────────────────────────
// USER PROFILE EXTRACTION
// Extrahuje fakty o USEROVI a ukladá do user_profile tabuľky
// ───────────────────────────────────────────────────
async function extractAndStoreUserProfile({ supabase, userId, userText, irisReply, llmClient, model }) {
  const combinedText = [
    userText ? `User: ${userText}` : null,
    irisReply ? `Iris: ${irisReply}` : null,
  ].filter(Boolean).join('\n');

  const extractPrompt = `You are extracting personal facts about the USER from a conversation with an AI companion called Iris.

Extract ONLY facts about the USER (not about Iris). Focus on:

- appearance: physical looks (hair, eyes, height, build, tattoos, style)
- personality: character traits, communication style, values
- hobbies: activities they enjoy regularly
- interests: topics they care about
- mood: current emotional state
- preferences: things they like (music, food, activities)
- dislikes: things they dislike
- personal: name, age, job, city, relationship status, life situation

Only extract facts that are clearly stated or strongly implied.
Ignore vague or uncertain information.

Conversation:
"""${combinedText}"""

Respond ONLY with a valid JSON array (can be empty []):
[
  {
    "category": "appearance|personality|hobbies|interests|mood|preferences|dislikes|personal",
    "fact_key": "snake_case_key (e.g. hair_color, current_mood, favorite_music)",
    "fact_value": "the value (e.g. blond, happy, techno)",
    "confidence": 0.6-1.0
  }
]`;

  const response = await llmClient.chat.completions.create({
    model,
    max_tokens: 400,
    temperature: 0,
    messages: [{ role: 'user', content: extractPrompt }],
  });

  const raw = response.choices?.[0]?.message?.content?.trim() || '';

  let facts = [];
  try {
    const match = raw.match(/[\s\S]*/);
    if (match) facts = JSON.parse(match[0]);
  } catch (e) {
    console.log('[USER_PROFILE_PARSE_ERROR]', e?.message);
    return;
  }

  if (!Array.isArray(facts) || facts.length === 0) return;

  for (const fact of facts) {
    if (!fact.fact_key || !fact.fact_value) continue;
    if ((fact.confidence || 0) < 0.6) continue;

    const { error } = await supabase
      .from('user_profile')
      .upsert({
        user_id: userId,
        category: fact.category || 'personal',
        fact_key: fact.fact_key,
        fact_value: String(fact.fact_value),
        confidence: fact.confidence || 0.8,
        source: 'auto',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,fact_key',
      });

    if (error) {
      console.log('[USER_PROFILE_UPSERT_ERROR]', error.message);
    } else {
      console.log('[USER_PROFILE_SAVED]', fact.fact_key, '=', fact.fact_value);
    }
  }
}