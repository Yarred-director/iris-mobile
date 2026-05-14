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
    console.log('[RECALL_EPISODIC_ERROR]', error.message);
    return { memories: [], meta: { confident: false, reason: error.message || 'rpc_error' } };
  }
  const memories = data || [];
  const topSimilarity = memories.length > 0 && typeof memories[0]?.similarity === 'number' ? memories[0].similarity : 0;
  const confident = isConfidentRecall(memories, { minSimilarity: 0.35, minCount: 1 });
  return {
    memories,
    meta: { confident, topSimilarity, match_threshold, match_count, reason: confident ? 'ok' : 'low_recall_confidence' },
  };
}

export async function recallSharedExperiences(supabaseClient, text, userID) {
  try {
    const embedding = await createEmbedding(text);
    const { data, error } = await supabaseClient.rpc('match_shared_experiences', {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 4,
      p_user_id: userID,
    });
    if (error) { console.log('[RECALL_SHARED_EXP_ERROR]', error.message); return []; }
    return data || [];
  } catch (e) {
    console.log('[RECALL_SHARED_EXP_ERROR]', e?.message);
    return [];
  }
}

export async function loadUserProfile(supabaseClient, userID) {
  try {
    const { data, error } = await supabaseClient
      .from('user_profile')
      .select('category, fact_key, fact_value, confidence')
      .eq('user_id', userID)
      .order('confidence', { ascending: false });
    if (error) { console.log('[LOAD_USER_PROFILE_ERROR]', error.message); return []; }
    return data || [];
  } catch (e) {
    console.log('[LOAD_USER_PROFILE_ERROR]', e?.message);
    return [];
  }
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

export function formatUserProfileBlock(profileFacts) {
  if (!profileFacts || profileFacts.length === 0) return '';
  const grouped = {};
  for (const fact of profileFacts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push('  - ' + fact.fact_key + ': ' + fact.fact_value);
  }
  const lines = ['USER_PROFILE:'];
  for (const [category, facts] of Object.entries(grouped)) {
    lines.push('[' + category.toUpperCase() + ']');
    lines.push(...facts);
  }
  lines.push('RULES:');
  lines.push('- Use this to personalize every response naturally.');
  lines.push('- Never list these facts back to the user robotically.');
  lines.push('- Reference them only when relevant and natural.');
  return lines.join('\n');
}

export function formatSharedExperiencesBlock(experiences) {
  if (!experiences || experiences.length === 0) return '';
  const lines = ['SHARED_MEMORIES (experiences we had together):'];
  experiences.forEach(function(exp, i) {
    const parts = [];
    if (exp.location) parts.push('@ ' + exp.location);
    if (exp.summary) parts.push(exp.summary);
    if (exp.actions && exp.actions.length) parts.push('Actions: ' + exp.actions.join(', '));
    if (exp.emotional_tone) parts.push('Tone: ' + exp.emotional_tone);
    if (exp.iris_emotion) parts.push('Iris felt: ' + exp.iris_emotion);
    lines.push((i + 1) + '. ' + parts.join(' | '));
  });
  lines.push('RULES:');
  lines.push('- These are real memories of things we experienced together.');
  lines.push('- Reference them naturally when relevant.');
  lines.push('- Do not list them all at once. Use them subtly to show you remember.');
  lines.push('- Intimate/erotic memories: reference with warmth and discretion unless user brings them up explicitly.');
  return lines.join('\n');
}

export function formatEpisodicMemoryBlock(memories) {
  if (!memories || memories.length === 0) return '';
  const lines = ['SOFT_EPISODIC_MEMORY:'];
  memories.slice(0, 4).forEach(function(m, i) {
    const tags = (m.emotional_tags && m.emotional_tags.length) ? m.emotional_tags.join(', ') : 'general';
    lines.push((i + 1) + '. [' + tags + '] ' + m.narrative);
  });
  lines.push('RULE: Use these memories naturally in conversation. Do not quote them verbatim.');
  return lines.join('\n');
}