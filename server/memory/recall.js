import { supabase } from '../config/supabase.js';
import { createEmbedding } from './embeddings.js';

/**
 * Generic confidence gate for memory recall.
 * No hard-coded domains/keywords.
 */
function isConfidentRecall(memories, { minSimilarity = 0.35, minCount = 1 } = {}) {
  if (!Array.isArray(memories) || memories.length < minCount) return false;
  const top = memories[0];
  const topSim = typeof top?.similarity === 'number' ? top.similarity : 0;
  return topSim >= minSimilarity;
}

/**
 * Recall episodic memories using v2 scorer (similarity + importance).
 * Returns:
 *  {
 *    memories: [...],
 *    meta: { confident, topSimilarity, match_threshold, match_count }
 *  }
 */
export async function recallEpisodicMemory(text) {
  const embedding = await createEmbedding(text);

  // Tuned defaults: allow broader candidate set; v2 re-ranking uses importance.
  const match_threshold = 0.25; // less strict than 0.45 to avoid empty recall
  const match_count = 12;       // more candidates -> less "fact dropouts"

  const { data, error } = await supabase.rpc('match_episodic_memory_v2', {
    query_embedding: embedding,
    match_threshold,
    match_count,
    w_similarity: 0.75,
    w_importance: 0.25,
  });

  if (error) {
    return {
      memories: [],
      meta: {
        confident: false,
        topSimilarity: 0,
        match_threshold,
        match_count,
        reason: `rpc_error:${error.message || 'unknown'}`,
      },
    };
  }

  const memories = data || [];
  const topSimilarity =
    memories.length > 0 && typeof memories[0]?.similarity === 'number'
      ? memories[0].similarity
      : 0;

  // Generic: if recall isn't strong, we treat it as "no reliable memory".
  const confident = isConfidentRecall(memories, { minSimilarity: 0.35, minCount: 1 });

  return {
    memories,
    meta: {
      confident,
      topSimilarity,
      match_threshold,
      match_count,
      reason: confident ? 'ok' : 'low_recall_confidence',
    },
  };
}

export async function loadCoreOrigin() {
  const { data, error } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'CORE_ORIGIN')
    .limit(1);

  if (error) return null;
  return data?.[0]?.narrative || null;
}

export async function loadSummaries() {
  const { data, error } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'SUMMARY')
    .order('created_at', { ascending: false })
    .limit(2);

  if (error) return [];
  return data || [];
}
