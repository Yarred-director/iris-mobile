// server/memory/memoryQuality.js

export const REINFORCEMENT_MIN_SIMILARITY = 0.35;
export const REINFORCEMENT_MAX_PER_RECALL = 4;
export const REINFORCEMENT_COOLDOWN_HOURS = 24;

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeMemoryAssessment(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    should_store: raw.should_store !== false,
    importance: clampNumber(raw.importance, 0.1, 1, 0.65),
    emotional_weight: Math.round(clampNumber(raw.emotional_weight, 0, 100, 50)),
  };
}

export function selectMemoriesForReinforcement(memories, {
  minSimilarity = REINFORCEMENT_MIN_SIMILARITY,
  maxCount = REINFORCEMENT_MAX_PER_RECALL,
} = {}) {
  const seen = new Set();
  const selected = [];
  for (const memory of Array.isArray(memories) ? memories : []) {
    const id = String(memory?.id || '').trim();
    const similarity = Number(memory?.similarity || 0);
    if (!id || seen.has(id) || !Number.isFinite(similarity) || similarity < minSimilarity) continue;
    seen.add(id);
    selected.push(id);
    if (selected.length >= maxCount) break;
  }
  return selected;
}

export async function reinforceRecalledMemories({ supabase, userId, memories }) {
  const memoryIds = selectMemoriesForReinforcement(memories);
  if (!userId || memoryIds.length === 0) return { attempted: 0, reinforced: 0 };

  const { data, error } = await supabase.rpc('reinforce_episodic_memories', {
    p_user_id: userId,
    p_memory_ids: memoryIds,
    p_cooldown_hours: REINFORCEMENT_COOLDOWN_HOURS,
  });
  if (error) {
    console.log('[MEMORY_REINFORCEMENT_ERROR]', error.message);
    return { attempted: memoryIds.length, reinforced: 0, error: error.message };
  }

  return {
    attempted: memoryIds.length,
    reinforced: Array.isArray(data) ? data.length : 0,
  };
}
