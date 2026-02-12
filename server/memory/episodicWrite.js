// server/memory/episodicWrite.js
import { randomUUID } from 'crypto';

/**
 * Language-agnostic FORCE marker.
 * You can use any of:
 *   ::remember:: your text...
 *   [MEMORY] your text...
 *   #remember your text...
 * OR you can send meta.force_memory=true from frontend later (best).
 */
function hasForceMarker(message, meta) {
  if (meta?.force_memory === true) return true;

  const t = String(message || '').trim();
  return (
    t.startsWith('::remember::') ||
    t.startsWith('[MEMORY]') ||
    t.toLowerCase().startsWith('#remember')
  );
}

function stripForceMarker(message) {
  return String(message || '')
    .replace(/^::remember::\s*/i, '')
    .replace(/^\[MEMORY\]\s*/i, '')
    .replace(/^#remember\s*/i, '')
    .trim();
}

/**
 * Step 1 (deterministic): ALWAYS write raw memory to DB.
 * Step 2 (LLM): enrich the row (title, summary narrative, tags, importance).
 */
export async function hybridWriteEpisodicMemory({
  supabase,
  userId,
  sceneKey = 'global',
  sceneContext,
  message,
  meta,
  enrichFn, // (rowId, rawText) => Promise<void>
}) {
  if (!hasForceMarker(message, meta)) return { wrote: false };

  const raw = stripForceMarker(message);

  const location =
    sceneContext?.place ||
    sceneContext?.room ||
    sceneContext?.city ||
    null;

  const rowId = randomUUID();

  // Deterministic write (no LLM, no schema, no guessing)
  const insertPayload = {
    id: rowId,
    user_id: userId,
    scene_key: sceneKey,
    title: 'Saved memory',
    narrative: raw,                // store raw first
    people: ['user'],              // minimal; LLM can enrich
    location,
    emotional_tags: [],
    memory_type: 'episodic_forced',
    memory_revision: 1,
    memory_note: JSON.stringify({ raw, stage: 'raw_write' }),
    importance: 0.95,
  };

  const { error } = await supabase
    .from('episodic_memory')
    .insert(insertPayload);

  if (error) {
    console.error('[EPISODIC_FORCE_WRITE_ERROR]', error);
    return { wrote: false, error };
  }

  // LLM enrichment (best effort; never blocks the save)
  if (typeof enrichFn === 'function') {
    try {
      await enrichFn(rowId, raw);
    } catch (e) {
      console.error('[EPISODIC_ENRICH_ERROR]', e?.message || e);
    }
  }

  return { wrote: true, id: rowId };
}