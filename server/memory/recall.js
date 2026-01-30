import { supabase } from '../config/supabase.js';
import { createEmbedding } from './embeddings.js';

export async function recallEpisodicMemory(text) {
  const embedding = await createEmbedding(text);
  const { data } = await supabase.rpc('match_episodic_memory', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 6,
  });
  return data || [];
}

export async function loadCoreOrigin() {
  const { data } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'CORE_ORIGIN')
    .limit(1);
  return data?.[0]?.narrative || null;
}

export async function loadSummaries() {
  const { data } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'SUMMARY')
    .order('created_at', { ascending: false })
    .limit(2);
  return data || [];
}
