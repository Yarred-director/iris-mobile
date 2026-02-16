// server/memory/recall.js
import { createEmbedding } from './embeddings.js';

function isConfidentRecall(memories, { minSimilarity = 0.35, minCount = 1 } = {}) {
  if (!Array.isArray(memories) || memories.length < minCount) return false;
  const top = memories[0];
  const topSim = typeof top?.similarity === 'number' ? top.similarity : 0;
  return topSim >= minSimilarity;
}

export async function recallEpisodicMemory(supabaseClient, text, userID) {
  const embedding = await createEmbedding(text);

  const match_threshold = 0.15;
  const match_count = 12;

  const { data, error } = await supabaseClient.rpc('match_episodic_memory_v2', {
    query_embedding: embedding,
    match_threshold,
    match_count,
    w_similarity: 0.75,
    w_importance: 0.25,
    p_user_id: userID,
  });

  if (error) {
  return {
    memories: [],
    meta: {
      confident: false,
      reason: error.message || 'rpc_error',
    },
  };
}

  const memories = data || [];
  const topSimilarity =
    memories.length > 0 && typeof memories[0]?.similarity === 'number'
      ? memories[0].similarity
      : 0;

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

export async function loadCoreOrigin(supabaseClient) {
  const { data, error } = await supabaseClient
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'CORE_ORIGIN')
    .limit(1);

  if (error) return null;
  return data?.[0]?.narrative || null;
}

export async function loadSummaries(supabaseClient) {
  const { data, error } = await supabaseClient
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'SUMMARY')
    .order('created_at', { ascending: false })
    .limit(2);

  if (error) return [];
  return data || [];
}
