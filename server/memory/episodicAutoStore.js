// server/memory/episodicAutoStore.js
import { randomUUID } from 'crypto';

/**
 * Hybrid autonomous memory pipeline:
 *
 * 1) LLM decides whether memory is worth storing
 * 2) If yes → deterministic DB insert (raw text)
 * 3) LLM enriches row (title, summary, tags, importance)
 *
 * No language triggers.
 * No hardcoded phrases.
 * Fully model-driven decision.
 */

export async function autoStoreEpisodicMemoryHybrid({
  supabase,
  userId,
  sceneKey = 'global',
  sceneContext,
  userText,
  llmClient,
  model,
}) {
  if (!userText || !userText.trim()) return;

  // --------------------------------------------------
  // STEP 1 — LLM decides if this message is memory-worthy
  // --------------------------------------------------

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
      { role: 'user', content: userText },
    ],
  });

  let judgeOutput = judgeResponse.output_text || '';

  let decision = null;
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

  if (!decision?.should_store) {
    return; // nothing to store
  }

  let importance = Number(decision.importance);
  if (!Number.isFinite(importance)) importance = 0.8;
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
    narrative: userText,
    people: ['user'],
    location,
    emotional_tags: [],
    memory_type: 'episodic',
    memory_revision: 1,
    memory_note: JSON.stringify({
      stage: 'raw',
      judge_reason: decision.reason || null,
    }),
    importance,
  };

  const { error } = await supabase
    .from('episodic_memory')
    .insert(insertPayload);

  if (error) {
    console.error('[AUTO_MEMORY_INSERT_ERROR]', error);
    return;
  }

  console.log('[AUTO_MEMORY_STORED]', rowId);

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
"""${userText}"""
`.trim();

  const enrichResponse = await llmClient.responses.create({
    model,
    temperature: 0.3,
    input: [{ role: 'user', content: enrichPrompt }],
  });

  let enrichOutput = enrichResponse.output_text || '';
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
  const summary =
    String(enrichData.summary || '').trim() || userText;

  const emotional_tags = Array.isArray(enrichData.emotional_tags)
    ? enrichData.emotional_tags
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  let enrichedImportance = Number(enrichData.importance);
  if (!Number.isFinite(enrichedImportance))
    enrichedImportance = importance;

  enrichedImportance = Math.max(
    0.3,
    Math.min(1.0, enrichedImportance)
  );

  const { error: updateError } = await supabase
    .from('episodic_memory')
    .update({
      title,
      narrative: summary,
      emotional_tags,
      importance: enrichedImportance,
      memory_revision: 2,
      memory_note: JSON.stringify({
        stage: 'enriched',
        original: userText,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (updateError) {
    console.error('[AUTO_MEMORY_ENRICH_ERROR]', updateError);
  }

  console.log('[AUTO_MEMORY_ENRICHED]', rowId);
}