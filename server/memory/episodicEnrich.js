// server/memory/episodicEnrich.js

function clampTitle(s) {
  const t = String(s || '').trim();
  return t.slice(0, 80) || 'Saved memory';
}

/**
 * Uses LLM to:
 * - create a short title
 * - rewrite narrative into a clean recall-friendly summary
 * - extract emotional tags
 * - adjust importance
 *
 * IMPORTANT: This never invents new facts. It only summarizes what user wrote.
 */
export async function enrichEpisodicMemory({
  supabase,
  llmClient,
  model,
  rowId,
  rawText,
}) {
  const prompt = `
You are a memory enricher for a personal AI.
Task: summarize the user's text WITHOUT adding new facts.

Return STRICT JSON with keys:
- title (string, <= 80 chars)
- summary (string, 1-2 sentences, neutral, recall-friendly)
- emotional_tags (array of short strings)
- importance (number 0.3 to 1.0)

User text:
"""${rawText}"""
`.trim();

  const r = await llmClient.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    // keep it stable
    temperature: 0.2,
  });

  const out = (r.output_text || '').trim();

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    // If model returns extra text, try to salvage JSON block
    const m = out.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }

  if (!parsed) return;

  const title = clampTitle(parsed.title);
  const summary = String(parsed.summary || '').trim() || rawText;
  const emotional_tags = Array.isArray(parsed.emotional_tags)
    ? parsed.emotional_tags.slice(0, 10).map(x => String(x).trim()).filter(Boolean)
    : [];

  let importance = Number(parsed.importance);
  if (!Number.isFinite(importance)) importance = 0.85;
  importance = Math.max(0.3, Math.min(1.0, importance));

  const memory_note = JSON.stringify({
    raw: rawText,
    summary,
    emotional_tags,
    stage: 'enriched',
  });

  const { error } = await supabase
    .from('episodic_memory')
    .update({
      title,
      narrative: summary,         // overwrite narrative with summary for recall
      emotional_tags,
      importance,
      memory_note,
      memory_revision: 2,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (error) {
    console.error('[EPISODIC_ENRICH_UPDATE_ERROR]', error);
  }
}