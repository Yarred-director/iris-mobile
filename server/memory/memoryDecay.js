// server/memory/memoryDecay.js
// Memory Decay Engine — Priority 3 of Iris Governance Engine
//
// Philosophy: Human memory is not deletion — it's compression and fading.
// Emotional memories persist. Mundane details evaporate.
// Nothing important is ever truly gone — it becomes an impression, a feeling.
//
// Three stages:
//   VIVID   (decay_score 60-100) — full recall, full narrative
//   FADING  (decay_score 25-59)  — narrative compressed to emotional essence
//   ECHO    (decay_score 5-24)   — only title + 1-sentence impression remains
//   GONE    (decay_score < 5)    — deleted, but only if not protected

// ────────────────────────────────────────────────────────────────
// HALF-LIFE MODEL
// ────────────────────────────────────────────────────────────────
function computeHalfLife({ importance = 0.5, emotional_weight = 50, reinforcement_count = 0 }) {
  const base         = 30;
  const importPart   = importance * 150;          // 0 → 0, 1.0 → 150
  const emotionPart  = (emotional_weight / 100) * 80; // 0 → 0, 100 → 80
  const reinforcePart = Math.min(reinforcement_count * 15, 90); // cap at 90

  return base + importPart + emotionPart + reinforcePart;
}

function computeDecayScore({ importance, emotional_weight, reinforcement_count, daysSinceRecall }) {
  const halfLife = computeHalfLife({ importance, emotional_weight, reinforcement_count });
  // Exponential decay: score = 100 × 0.5^(days / halfLife)
  const score = 100 * Math.pow(0.5, daysSinceRecall / halfLife);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function isProtected(memory) {
  return (
    memory.memory_type === 'CORE_ORIGIN' ||
    (memory.importance >= 0.9 && (memory.emotional_weight || 50) >= 70) ||
    (memory.reinforcement_count || 0) >= 3
  );
}

// ────────────────────────────────────────────────────────────────
// LLM COMPRESSION
// ────────────────────────────────────────────────────────────────
async function compressNarrative({ narrative, title, stage, llmClient, model }) {
  try {
    const instruction = stage === 'FADING'
      ? 'Distill this memory to its emotional and relational essence in 1-2 sentences. Keep the feeling, lose the details.'
      : 'Reduce this memory to a single sentence — just the core emotional impression.';

    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 120,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: `${instruction}\n\nMemory title: "${title}"\nNarrative:\n${narrative.slice(0, 800)}`,
      }],
    });

    return resp.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.log('[DECAY] Compression failed:', e?.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// MAIN DECAY RUNNER
// ────────────────────────────────────────────────────────────────
function runMemoryDecay({ supabase, userId, llmClient, model }) {
  console.log('[DECAY] Starting decay run for user', userId);

  const { data: memories, error } = await supabase
    .from('episodic_memory')
    .select('id, title, narrative, importance, emotional_weight, reinforcement_count, last_recalled_at, created_at, memory_type, decay_score')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(60);

  if (error || !memories?.length) {
    console.log('[DECAY] No memories or error:', error?.message);
    return { processed: 0, compressed: 0, deleted: 0 };
  }

  const now = Date.now();
  let compressed = 0;
  let deleted = 0;
  const MAX_DELETES_PER_RUN = 3;

  for (const mem of memories) {
    // Skip protected memories entirely
    if (isProtected(mem)) {
      console.log(`[DECAY] Protected: "${mem.title}" (${mem.memory_type || 'high-importance'})`);
      continue;
    }

    const lastActive = mem.last_recalled_at || mem.created_at;
    const daysSinceRecall = Math.floor((now - new Date(lastActive).getTime()) / 86400000);

    const newDecayScore = computeDecayScore({
      importance: mem.importance || 0.5,
      emotional_weight: mem.emotional_weight || 50,
      reinforcement_count: mem.reinforcement_count || 0,
      daysSinceRecall,
    });

    const prevScore = mem.decay_score ?? 100;
    const scoreChanged = Math.abs(newDecayScore - prevScore) >= 1;

    // ── STAGE: GONE — delete if score < 5 and not important
    if (newDecayScore < 5 && (mem.importance || 0.5) < 0.7) {
      if (deleted >= MAX_DELETES_PER_RUN) continue;

      console.log(`[DECAY] Deleting: "${mem.title}" (score=${newDecayScore}, days=${daysSinceRecall})`);
      await supabase.from('episodic_memory').delete().eq('id', mem.id);
      deleted++;
      continue;
    }

    // ── STAGE: ECHO — compress to single sentence if crossed threshold
    if (newDecayScore < 25 && prevScore >= 25 && mem.narrative?.length > 100) {
      console.log(`[DECAY] ECHO compression: "${mem.title}" (score=${newDecayScore})`);
      const compressed_narrative = await compressNarrative({
        narrative: mem.narrative,
        title: mem.title,
        stage: 'ECHO',
        llmClient,
        model,
      });

      await supabase
        .from('episodic_memory')
        .update({
          narrative: compressed_narrative || mem.narrative.slice(0, 120) + '…',
          decay_score: newDecayScore,
          memory_note: (mem.memory_note || '') + ' [echo]',
        })
        .eq('id', mem.id);

      compressed++;
      continue;
    }

    // ── STAGE: FADING — compress narrative when crossing 60→<60
    if (newDecayScore < 60 && prevScore >= 60 && mem.narrative?.length > 150) {
      console.log(`[DECAY] FADING compression: "${mem.title}" (score=${newDecayScore})`);
      const compressed_narrative = await compressNarrative({
        narrative: mem.narrative,
        title: mem.title,
        stage: 'FADING',
        llmClient,
        model,
      });

      await supabase
        .from('episodic_memory')
        .update({
          narrative: compressed_narrative || mem.narrative.slice(0, 250) + '…',
          decay_score: newDecayScore,
          memory_note: (mem.memory_note || '') + ' [fading]',
        })
        .eq('id', mem.id);

      compressed++;
      continue;
    }

    // ── UPDATE decay_score only if meaningfully changed
    if (scoreChanged) {
      await supabase
        .from('episodic_memory')
        .update({ decay_score: newDecayScore })
        .eq('id', mem.id);
    }
  }

  console.log(`[DECAY] Done — processed: ${memories.length}, compressed: ${compressed}, deleted: ${deleted}`);
  return { processed: memories.length, compressed, deleted };
}

// ────────────────────────────────────────────────────────────────
// LAZY TRIGGER — call once per session, max once per 24h per user
// ────────────────────────────────────────────────────────────────
const _lastRunPerUser = new Map();

export async function maybeRunDecay({ supabase, userId, llmClient, model }) {
  const lastRun = _lastRunPerUser.get(userId) || 0;
  const hoursSinceLastRun = (Date.now() - lastRun) / 3600000;

  // Run at most once per 24h per user per server instance
  if (hoursSinceLastRun < 24) return;

  _lastRunPerUser.set(userId, Date.now());

  // Non-blocking — runs in background
  runMemoryDecay({ supabase, userId, llmClient, model })
    .catch(e => console.log('[DECAY] Background run error:', e?.message));
}
