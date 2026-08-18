// server/memory/memoryDecay.js
// Human-style memory compression/fading. Triggered lazily, max once per 24h per process/user.

function computeHalfLife(importance, emotional_weight, reinforcement_count) {
  const base = 30;
  const importPart = (importance || 0.5) * 150;
  const emotionPart = ((emotional_weight || 50) / 100) * 80;
  const reinforcePart = Math.min((reinforcement_count || 0) * 15, 90);
  return base + importPart + emotionPart + reinforcePart;
}

function computeDecayScore(importance, emotional_weight, reinforcement_count, daysSinceRecall) {
  const halfLife = computeHalfLife(importance, emotional_weight, reinforcement_count);
  const score = 100 * Math.pow(0.5, daysSinceRecall / halfLife);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function isProtected(mem) {
  return mem.memory_type === 'CORE_ORIGIN' ||
    ((mem.importance || 0) >= 0.9 && (mem.emotional_weight || 50) >= 70) ||
    (mem.reinforcement_count || 0) >= 3;
}

async function compressNarrative(narrative, title, stage, llmClient, model) {
  try {
    const instruction = stage === 'FADING'
      ? 'Distill this memory to its emotional and relational essence in 1-2 sentences. Keep the feeling, lose mundane detail.'
      : 'Reduce this memory to one sentence containing only the core emotional impression.';

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 140,
      input: [{
        role: 'user',
        content: `${instruction}\n\nTitle: ${JSON.stringify(title)}\nNarrative:\n${String(narrative || '').slice(0, 800)}`,
      }],
    });
    return resp.output_text?.trim() || null;
  } catch (e) {
    console.log('[DECAY] Compression failed:', e?.message);
    return null;
  }
}

export async function runMemoryDecay({ supabase, userId, llmClient, model }) {
  console.log('[DECAY] Starting for user', userId);

  const { data: memories, error } = await supabase
    .from('episodic_memory')
    .select('id, title, narrative, importance, emotional_weight, reinforcement_count, last_recalled_at, created_at, memory_type, decay_score, memory_note')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(60);

  if (error || !memories || memories.length === 0) {
    console.log('[DECAY] No memories or error:', error?.message);
    return { processed: 0, compressed: 0, deleted: 0 };
  }

  const now = Date.now();
  const MAX_DELETES = 3;
  let compressed = 0;
  let deleted = 0;

  for (const mem of memories) {
    if (isProtected(mem)) continue;
    const lastActive = mem.last_recalled_at || mem.created_at;
    const daysSinceRecall = Math.floor((now - new Date(lastActive).getTime()) / 86400000);
    const newScore = computeDecayScore(mem.importance, mem.emotional_weight, mem.reinforcement_count, daysSinceRecall);
    const prevScore = mem.decay_score != null ? mem.decay_score : 100;

    if (newScore < 5 && (mem.importance || 0.5) < 0.7) {
      if (deleted >= MAX_DELETES) continue;
      await supabase.from('episodic_memory').delete().eq('id', mem.id);
      deleted++;
      continue;
    }

    if (newScore < 25 && prevScore >= 25 && mem.narrative && mem.narrative.length > 100) {
      const compressedText = await compressNarrative(mem.narrative, mem.title, 'ECHO', llmClient, model);
      await supabase.from('episodic_memory').update({
        narrative: compressedText || mem.narrative.slice(0, 120) + '…',
        decay_score: newScore,
        memory_note: (mem.memory_note || '') + ' [echo]',
      }).eq('id', mem.id);
      compressed++;
      continue;
    }

    if (newScore < 60 && prevScore >= 60 && mem.narrative && mem.narrative.length > 150) {
      const compressedText = await compressNarrative(mem.narrative, mem.title, 'FADING', llmClient, model);
      await supabase.from('episodic_memory').update({
        narrative: compressedText || mem.narrative.slice(0, 250) + '…',
        decay_score: newScore,
        memory_note: (mem.memory_note || '') + ' [fading]',
      }).eq('id', mem.id);
      compressed++;
      continue;
    }

    if (Math.abs(newScore - prevScore) >= 1) {
      await supabase.from('episodic_memory').update({ decay_score: newScore }).eq('id', mem.id);
    }
  }

  console.log('[DECAY] Done — processed:', memories.length, 'compressed:', compressed, 'deleted:', deleted);
  return { processed: memories.length, compressed, deleted };
}

const _lastRunPerUser = new Map();

export async function maybeRunDecay({ supabase, userId, llmClient, model }) {
  const lastRun = _lastRunPerUser.get(userId) || 0;
  if ((Date.now() - lastRun) / 3600000 < 24) return;
  _lastRunPerUser.set(userId, Date.now());
  runMemoryDecay({ supabase, userId, llmClient, model }).catch(e => console.log('[DECAY] Error:', e?.message));
}
