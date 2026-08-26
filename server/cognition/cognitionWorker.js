// server/cognition/cognitionWorker.js
// Periodic, DB-claimed background reflection. It gives Iris persistent inner continuity
// between user messages without keeping an LLM running continuously.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { loadRecentChatMessages, saveChatMessage } from '../memory/chatHistory.js';
import { loadPersonalityEvolution } from '../memory/personalityEvolution.js';
import { loadSelfModel } from '../memory/selfAwareness.js';
import { sendExpoPush } from '../push/expoPush.js';
import {
  loadCognitiveContinuity,
  evaluateProactiveEligibility,
  markThoughtSent,
  runBackgroundReflection,
} from './cognitiveEngine.js';

const DEFAULT_COGNITION_INTERVAL_MINUTES = 180;
const DEFAULT_PROACTIVE_INTERVAL_HOURS = 16;
const DEFAULT_ACTIVE_WINDOW_DAYS = 14;
const DEFAULT_SWEEP_LIMIT = 25;

let timer = null;
let firstRunTimer = null;
let sweepRunning = false;

function intEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function cognitionEnabled() {
  return String(process.env.IRIS_COGNITION_ENABLED || 'true').toLowerCase() !== 'false';
}

function safeClientId(userId, subject, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const suffix = Buffer.from(`${userId}|${subject || 'thought'}|${day}`).toString('base64url').slice(0, 48);
  return `proactive:${day}:${suffix}`;
}

async function loadRecentEpisodicMemories(supabase, userId) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('episodic_memory')
    .select('id, title, narrative, importance, emotional_weight, created_at, reinforcement_count, decay_score')
    .eq('user_id', userId)
    .gte('created_at', cutoff)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    console.log('[COGNITION_WORKER_EPISODIC_LOAD]', error.message);
    return [];
  }
  return data || [];
}

async function sendExpoProactivePush(supabase, userId, message) {
  try {
    const { data, error } = await supabase
      .from('push_tokens')
      .select('id, expo_push_token')
      .eq('user_id', userId)
      .is('disabled_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(5);
    if (error || !data?.length) return;
    for (const token of data) {
      const result = await sendExpoPush({
        to: token.expo_push_token,
        title: 'Iris',
        body: message,
        data: { type: 'iris_proactive_message' },
      });
      if (result?.ok) return;
      console.log('[COGNITION_EXPO_PUSH_FAILED]', result?.error || 'unknown');
      const deviceNotRegistered = result?.details?.tickets?.some((ticket) => ticket?.details?.error === 'DeviceNotRegistered');
      if (deviceNotRegistered) {
        const now = new Date().toISOString();
        await supabase.from('push_tokens').update({ disabled_at: now, updated_at: now }).eq('id', token.id);
      }
    }
  } catch (error) {
    console.log('[COGNITION_EXPO_PUSH_ERROR]', error?.message);
  }
}

async function processUser({ supabase, profile, llmClient, model }) {
  const userId = profile?.user_id;
  if (!userId) return { claimed: false, sent: false };

  const cognitionIntervalMinutes = intEnv(
    'IRIS_COGNITION_MIN_INTERVAL_MINUTES',
    DEFAULT_COGNITION_INTERVAL_MINUTES,
    60,
    1440,
  );
  const { data: claimed, error: claimError } = await supabase.rpc('claim_iris_cognition', {
    p_user_id: userId,
    p_min_interval_minutes: cognitionIntervalMinutes,
  });
  if (claimError) {
    console.log('[COGNITION_CLAIM_ERROR]', userId, claimError.message);
    return { claimed: false, sent: false };
  }
  if (claimed !== true) return { claimed: false, sent: false };

  const [selfModel, personalityEvolution, cognitiveContinuity, recentEpisodicMemories, recentChat] = await Promise.all([
    loadSelfModel(supabase, userId),
    loadPersonalityEvolution(supabase, userId),
    loadCognitiveContinuity(supabase, userId),
    loadRecentEpisodicMemories(supabase, userId),
    loadRecentChatMessages(supabase, userId, 10),
  ]);

  const candidate = await runBackgroundReflection({
    supabase,
    userId,
    profile,
    selfModel,
    personalityEvolution,
    cognitiveContinuity,
    recentEpisodicMemories,
    recentChat,
    llmClient,
    model,
  });

  if (!candidate?.should_reach_out || !candidate.message) return { claimed: true, sent: false };

  const now = new Date();
  const eligibility = evaluateProactiveEligibility({
    proactivityEnabled: profile?.proactivity_enabled !== false,
    timezone: profile?.user_timezone || 'UTC',
    quietHours: profile?.proactivity_quiet_hours || null,
    lastInteractionAt: profile?.last_interaction_at || null,
    lastProactiveAt: selfModel?.last_proactive_at || null,
    urge: candidate.urge,
    now,
  });
  if (!eligibility.allowed) {
    console.log('[COGNITION_PROACTIVE_SKIPPED]', { userId, reason: eligibility.reason, urge: candidate.urge });
    return { claimed: true, sent: false };
  }

  const proactiveIntervalHours = intEnv(
    'IRIS_PROACTIVE_MIN_INTERVAL_HOURS',
    DEFAULT_PROACTIVE_INTERVAL_HOURS,
    6,
    168,
  );
  const { data: proactiveClaimed, error: proactiveClaimError } = await supabase.rpc('claim_iris_proactive_reachout', {
    p_user_id: userId,
    p_min_interval_hours: proactiveIntervalHours,
  });
  if (proactiveClaimError || proactiveClaimed !== true) {
    if (proactiveClaimError) console.log('[COGNITION_PROACTIVE_CLAIM_ERROR]', userId, proactiveClaimError.message);
    return { claimed: true, sent: false };
  }

  const saved = await saveChatMessage(supabase, {
    userId,
    role: 'assistant',
    content: candidate.message,
    clientMessageId: safeClientId(userId, candidate.subject || candidate.thought_id, now),
  });
  if (!saved) return { claimed: true, sent: false };

  await markThoughtSent(supabase, userId, candidate.thought_id, candidate.subject);
  // saveChatMessage already triggers Web Push; Expo is only an additional native-app path.
  sendExpoProactivePush(supabase, userId, candidate.message).catch(() => {});
  console.log('[COGNITION_PROACTIVE_SENT]', { userId, subject: candidate.subject || null, urge: candidate.urge });
  return { claimed: true, sent: true };
}

export async function runCognitionSweep() {
  if (!cognitionEnabled()) return { disabled: true, processed: 0, sent: 0 };
  if (sweepRunning) return { skipped: 'already_running', processed: 0, sent: 0 };
  sweepRunning = true;
  try {
    const supabase = getSupabaseAdmin();
    const llmClient = getLLMClient('openai');
    const model = MODELS.openaiUtility || MODELS.openai;
    const activeDays = intEnv('IRIS_COGNITION_ACTIVE_WINDOW_DAYS', DEFAULT_ACTIVE_WINDOW_DAYS, 1, 90);
    const limit = intEnv('IRIS_COGNITION_SWEEP_LIMIT', DEFAULT_SWEEP_LIMIT, 1, 100);
    const cutoff = new Date(Date.now() - activeDays * 86400000).toISOString();

    const { data: profiles, error } = await supabase
      .from('iris_profiles')
      .select('user_id, user_timezone, last_interaction_at, proactivity_enabled, proactivity_quiet_hours')
      .not('last_interaction_at', 'is', null)
      .gte('last_interaction_at', cutoff)
      .order('last_interaction_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    let processed = 0;
    let sent = 0;
    for (const profile of profiles || []) {
      try {
        const result = await processUser({ supabase, profile, llmClient, model });
        if (result.claimed) processed += 1;
        if (result.sent) sent += 1;
      } catch (error) {
        console.log('[COGNITION_USER_ERROR]', profile?.user_id, error?.message || error);
      }
    }
    console.log('[COGNITION_SWEEP_DONE]', { candidates: profiles?.length || 0, processed, sent });
    return { processed, sent };
  } catch (error) {
    console.log('[COGNITION_SWEEP_ERROR]', error?.message || error);
    return { error: error?.message || String(error), processed: 0, sent: 0 };
  } finally {
    sweepRunning = false;
  }
}

export function startCognitionLoop() {
  if (!cognitionEnabled() || timer || firstRunTimer) return false;
  const sweepMs = intEnv('IRIS_COGNITION_SWEEP_MINUTES', 60, 15, 360) * 60000;
  firstRunTimer = setTimeout(() => {
    firstRunTimer = null;
    runCognitionSweep().catch(() => {});
    timer = setInterval(() => runCognitionSweep().catch(() => {}), sweepMs);
    timer.unref?.();
  }, Math.min(90000, Math.max(15000, Math.floor(sweepMs / 4))));
  firstRunTimer.unref?.();
  console.log('[COGNITION_LOOP_STARTED]', { sweepMinutes: sweepMs / 60000 });
  return true;
}

export function stopCognitionLoop() {
  if (firstRunTimer) clearTimeout(firstRunTimer);
  if (timer) clearInterval(timer);
  firstRunTimer = null;
  timer = null;
}
