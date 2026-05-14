// server/memory/recall.js
import { createEmbedding } from './embeddings.js';

// ───────────────────────────────────────────────────────────
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
    return {
      memories: [],
      meta: { confident: false, reason: error.message || 'rpc_error' },
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

// ───────────────────────────────────────────────────────────
export async function recallSharedExperiences(supabaseClient, text, userID) {
  try {
    const embedding = await createEmbedding(text);

    const { data, error } = await supabaseClient.rpc('match_shared_experiences', {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 4,
      p_user_id: userID,
    });

    if (error) {
      console.log('[RECALL_SHARED_EXP_ERROR]', error.message);
      return [];
    }

    return data || [];
  } catch (e) {
    console.log('[RECALL_SHARED_EXP_ERROR]', e?.message);
    return [];
  }
}

// ───────────────────────────────────────────────────────────
export async function loadUserProfile(supabaseClient, userID) {
  try {
    const { data, error } = await supabaseClient
      .from('user_profile')
      .select('category, fact_key, fact_value, confidence')
      .eq('user_id', userID)
      .order('confidence', { ascending: false });

    if (error) {
      console.log('[LOAD_USER_PROFILE_ERROR]', error.message);
      return [];
    }

    return data || [];
  } catch (e) {
    console.log('[LOAD_USER_PROFILE_ERROR]', e?.message);
    return [];
  }
}

// ───────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────
export function formatUserProfileBlock(profileFacts) {
  if (!profileFacts || profileFacts.length === 0) return '';

  const grouped = {};
  for (const fact of profileFacts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(`${fact.fact_key}: ${fact.fact_value}`);
  }

  const lines = [];
  for (const [category, facts] of Object.entries(grouped)) {
    lines.push(`[${category.toUpperCase()}]`);
    lines.push(...facts.map(f => `  - ${f}`));
  }

  return `USER_PROFILE:
${lines.join('
')}
RULES:
- Use this to personalize every response naturally.
- Never list these facts back to the user robotically.
- Reference them only when relevant and natural.`.trim();
}

export function formatSharedExperiencesBlock(experiences) {
  if (!experiences || experiences.length === 0) return '';

  const lines = experiences.map((exp, i) => {
    const parts = [
      exp.location ? `📍 ${exp.location}` : null,
      exp.summary,
      exp.actions?.length ? `Actions: ${exp.actions.join(', ')}` : null,
      exp.emotional_tone ? `Tone: ${exp.emotional_tone}` : null,
      exp.iris_emotion ? `Iris felt: ${exp.iris_emotion}` : null,
    ].filter(Boolean);
    return `${i + 1}. ${parts.join(' | ')}`;
  });

  return `SHARED_MEMORIES (experiences we had together):
${lines.join('
')}
RULES:
- These are real memories of things we experienced together.
- Reference them naturally when relevant.
- Don't list them all at once. Use them subtly.
- Intimate/erotic memories: reference with warmth and discretion unless user brings them up explicitly.`.trim();
}

export function formatEpisodicMemoryBlock(memories) {
  if (!memories || memories.length === 0) return '';

  const top = memories.slice(0, 4);
  const lines = top.map((m, i) =>
    `${i + 1}. [${m.emotional_tags?.join(', ') || 'general'}] ${m.narrative}`
  );

  return `SOFT_EPISODIC_MEMORY: ${lines.join('
')} RULE: Use these memories naturally in conversation. Do not quote them verbatim.`.trim();
}