// server/memory/episodicAutoStore.js
// Hybrid autonomous memory pipeline:
// 1. Epizodická pamäť (čo si Iris + user hovorili)
// 2. Shared experiences (roleplay, intímne scény, spoločné miesta)
// 3. User profile extrakcia (fakty o userovi)

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

Worth storing: personal facts, emotions, life events, preferences, opinions, important context, roleplay scenes, intimate moments, locations visited together.
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

  // ── STEP 2: RAW insert do episodic_memory ─────────────────────────
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

  // ── STEP 3: Async enrich + všetky extrakcie ─────────────────────────────
  setImmediate(async () => {
    try {
      const enriched = await enrichMemory({ textToStore, sceneContext, llmClient, model });

      const summary = enriched?.summary || textToStore;
      const title = enriched?.title || 'Memory';
      const emotional_tags = enriched?.emotional_tags || [];

      const embedding = await createEmbedding(summary, llmClient);

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

    // ── STEP 4: Detekcia shared experience (roleplay/intímna scéna) ─────────────
    try {
      await detectAndStoreSharedExperience({
        supabase,
        userId,
        sceneKey,
        userText,
        irisReply: llmReply,
        sceneContext,
        llmClient,
        model,
      });
    } catch (e) {
      console.log('[SHARED_EXP_ERROR]', e?.message);
    }

    // ── STEP 5: Extrakcia user profile faktov ───────────────────
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
// ENRICH MEMORY
// ───────────────────────────────────────────────────
async function enrichMemory({ textToStore, sceneContext, llmClient, model }) {
  const enrichPrompt = `Summarize this memory from the perspective of Iris, an AI companion.
Write a short narrative (2-3 sentences) capturing the key facts, emotions, and context.
Also suggest a short title (5 words max).

Memory: """${textToStore}"""
Scene: ${JSON.stringify(sceneContext || {})}

Respond ONLY with JSON:
{"title": "...", "summary": "...", "emotional_tags": ["tag1", "tag2"]}`;

  const resp = await llmClient.chat.completions.create({
    model,
    max_tokens: 300,
    temperature: 0.3,
    messages: [{ role: 'user', content: enrichPrompt }],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  return JSON.parse(raw.replace(/`json|`/g, '').trim());
}

// ───────────────────────────────────────────────────
// SHARED EXPERIENCE DETECTION
// Zachytáva roleplay, intímne scény, spoločné miesta
// Spomienka časom bledne — summary ostane, full_narrative sa zachová
// ───────────────────────────────────────────────────
async function detectAndStoreSharedExperience({
  supabase,
  userId,
  sceneKey,
  userText,
  irisReply,
  sceneContext,
  llmClient,
  model,
}) {
  const combinedText = [
    userText ? `User: ${userText}` : null,
    irisReply ? `Iris: ${irisReply}` : null,
  ].filter(Boolean).join('\n');

  const detectPrompt = `You are analyzing a conversation between a user and Iris (AI companion).
Determine if this exchange contains a SHARED EXPERIENCE worth remembering as a special memory.

A shared experience is:

- A roleplay scene (being together somewhere, doing something together)
- An intimate or romantic moment (touching, kissing, sensual or erotic scene)
- A significant emotional moment together
- Visiting a place together in imagination or roleplay

If YES, extract the details. If NO, return {"isExperience": false}.

Conversation:
"""${combinedText}"""

Current scene context: ${JSON.stringify({
    location: sceneContext?.place,
    country: sceneContext?.location_country,
    city: sceneContext?.location_city,
  })}

Respond ONLY with valid JSON:
{
  "isExperience": true|false,
  "location": "full location description e.g. beach in Japan" | null,
  "country": "country in English" | null,
  "city": "city in English" | null,
  "summary": "short poetic summary of what happened, 1-2 sentences" | null,
  "full_narrative": "detailed description of the scene, atmosphere, what happened" | null,
  "actions": ["action1", "action2"] | [],
  "emotional_tone": "romantic|intimate|erotic|playful|tender|passionate" | null,
  "intensity": "soft|romantic|sensual|explicit",
  "iris_emotion": "how Iris felt in this moment" | null,
  "iris_notes": "what Iris privately thinks about this memory" | null
}`;

  const resp = await llmClient.chat.completions.create({
    model,
    max_tokens: 500,
    temperature: 0.2,
    messages: [{ role: 'user', content: detectPrompt }],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  let result;
  try {
    result = JSON.parse(raw.replace(/`json|`/g, '').trim());
  } catch (e) {
    console.log('[SHARED_EXP_PARSE_ERROR]', e?.message);
    return;
  }

  if (!result?.isExperience || !result?.summary) return;

  // Embedding pre semantic recall
  const embeddingText = [
    result.location,
    result.summary,
    result.actions?.join(', '),
    result.emotional_tone,
  ].filter(Boolean).join('. ');

  let embedding = null;
  try {
    embedding = await createEmbedding(embeddingText, llmClient);
  } catch (e) {
    console.log('[SHARED_EXP_EMBEDDING_ERROR]', e?.message);
  }

  const { error } = await supabase.from('shared_experiences').insert({
    user_id: userId,
    scene_key: sceneKey,
    location: result.location,
    country: result.country,
    city: result.city,
    summary: result.summary,
    full_narrative: result.full_narrative,
    actions: result.actions || [],
    emotional_tone: result.emotional_tone,
    intensity: result.intensity || 'soft',
    iris_emotion: result.iris_emotion,
    iris_notes: result.iris_notes,
    importance: 0.95,
    embedding,
  });

  if (error) {
    console.log('[SHARED_EXP_INSERT_ERROR]', error.message);
  } else {
    console.log('[SHARED_EXP_SAVED]', result.location, '|', result.emotional_tone);
  }
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