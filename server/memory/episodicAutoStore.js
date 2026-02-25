import { randomUUID } from 'crypto';
import { createEmbedding } from './embeddings.js';

/**
 * Hybrid autonomous memory pipeline:
 *
 * 1) LLM decides whether memory is worth storing
 * 2) If yes → deterministic DB insert (raw text)
 * 3) LLM enriches row (title, summary, tags, importance)
 * 4) ✅ Generate embedding from SUMMARY and store it (required for recall)
 *
 * No language triggers.
 * No hardcoded phrases.
 * Fully model-driven decision.
 * 
 * UPDATED 25.2.2026: podporuje llmReply (Grok hardcore scény) + bypass OpenAI filter
 */

export async function autoStoreEpisodicMemoryHybrid({
  supabase,
  userId,
  sceneKey = 'global',
  sceneContext,
  userText,
  llmReply = null,           // ← NOVÉ: Grok / OpenAI reply
  llmClient,
  model,
}) {
  const textToStore = llmReply || userText;
  if (!textToStore || !textToStore.trim()) return;

  // --------------------------------------------------
  // STEP 1 — LLM decides if this message is memory-worthy
  // --------------------------------------------------
  let decision = { should_store: true, reason: 'IRIS reply - always store', importance: 0.9 };

  if (!llmReply) {
    // pôvodný judge len pre user messages
    const judgePrompt = `
You are a memory decision system for a long-term AI.

Decide whether the user's message contains a meaningful event,
emotional moment, commitment, gift, milestone, shared experience,
or something that should be remembered long-term.

Return STRICT JSON:

{
  "should_store": boolean,
  "reason": string,
  "importance": number (0.3 to 1.0)
}

Rules:
- Store only if it represents a meaningful event or emotional memory.
- Do NOT store normal conversation, small talk, or simple questions.
- Be selective but not overly strict.
`.trim();

    const judgeResponse = await llmClient.responses.create({
      model,
      temperature: 0.2,
      input: [
        { role: 'system', content: judgePrompt },
        { role: 'user', content: textToStore },
      ],
    });

    const judgeOutput = judgeResponse.output_text || '';

    try {
      decision = JSON.parse(judgeOutput);
    } catch {
      const match = judgeOutput.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          decision = JSON.parse(match[0]);
        } catch {}
      }
    }
  }

  if (!decision?.should_store) return;

  let importance = Number(decision.importance);
  if (!Number.isFinite(importance)) importance = 0.85;
  importance = Math.max(0.3, Math.min(1.0, importance));

  // --------------------------------------------------
  // STEP 2 — Deterministic insert (RAW memory first)
  // --------------------------------------------------

  const rowId = randomUUID();

  const location =
    sceneContext?.place ||
    sceneContext?.room ||
    sceneContext?.city ||
    null;

  const insertPayload = {
    id: rowId,
    user_id: userId,
    scene_key: sceneKey,
    title: 'Pending memory',
    narrative: textToStore,
    people: ['Iris', 'user'],
    location,
    emotional_tags: [],
    memory_type: 'episodic',
    memory_revision: 1,
    memory_note: JSON.stringify({
      stage: 'raw',
      is_llm_reply: !!llmReply,
      judge_reason: decision.reason || null,
    }),
    importance,
  };

  const { error: insertError } = await supabase
    .from('episodic_memory')
    .insert(insertPayload);

  if (insertError) {
    console.error('[AUTO_MEMORY_INSERT_ERROR]', insertError);
    return;
  }

  console.log('[AUTO_MEMORY_STORED]', rowId, llmReply ? '(GROK REPLY)' : '(USER)');

  // --------------------------------------------------
  // STEP 3 — LLM enrichment (non-blocking intelligence)
  // --------------------------------------------------

  const enrichPrompt = `
You are refining a stored memory.

Summarize the text without adding new facts.
Make it concise and recall-friendly.

Return STRICT JSON:

{
  "title": string (max 80 chars),
  "summary": string (1–2 sentences),
  "emotional_tags": string[],
  "importance": number (0.3–1.0)
}

Original text:
"""${textToStore}"""
`.trim();

  const enrichResponse = await llmClient.responses.create({
    model,
    temperature: 0.3,
    input: [{ role: 'user', content: enrichPrompt }],
  });

  const enrichOutput = enrichResponse.output_text || '';
  let enrichData = null;

  try {
    enrichData = JSON.parse(enrichOutput);
  } catch {
    const match = enrichOutput.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        enrichData = JSON.parse(match[0]);
      } catch {}
    }
  }

  if (!enrichData) return;

  const title = String(enrichData.title || '').slice(0, 80) || 'Memory';
  const summary = String(enrichData.summary || '').trim() || textToStore;

  const emotional_tags = Array.isArray(enrichData.emotional_tags)
    ? enrichData.emotional_tags
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  let enrichedImportance = Number(enrichData.importance);
  if (!Number.isFinite(enrichedImportance)) enrichedImportance = importance;

  enrichedImportance = Math.max(0.3, Math.min(1.0, enrichedImportance));

  // --------------------------------------------------
  // STEP 4 — ✅ Create embedding (required for recall)
  // --------------------------------------------------
  let embedding = null;
  try {
    embedding = await createEmbedding(summary);
  } catch (e) {
    console.error('[AUTO_MEMORY_EMBEDDING_ERROR]', e?.message || e);
  }

  const { error: updateError } = await supabase
    .from('episodic_memory')
    .update({
      title,
      narrative: summary,
      emotional_tags,
      importance: enrichedImportance,
      embedding,
      memory_revision: 2,
      memory_note: JSON.stringify({
        stage: 'enriched',
        original: textToStore,
        is_llm_reply: !!llmReply,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (updateError) {
    console.error('[AUTO_MEMORY_ENRICH_ERROR]', updateError);
    return;
  }

  console.log('[AUTO_MEMORY_ENRICHED]', rowId, llmReply ? '(GROK REPLY)' : '(USER)');
}