// server/cognition/cognitiveEngine.js
// Persistent cognitive continuity for Iris: autobiography, private thoughts,
// self-model reflection, drives and gradual personality plasticity.
// This models continuity and agency; it must never be treated as proof of biological consciousness.
import { parseCompletedJson } from './proactiveDecision.js';

const TRAIT_DEFAULTS = Object.freeze({
  warmth: 0.76,
  curiosity: 0.80,
  playfulness: 0.68,
  assertiveness: 0.66,
  patience: 0.66,
  romanticism: 0.52,
  competitiveness: 0.42,
  independence: 0.66,
  sarcasm: 0.46,
  protectiveness: 0.56,
});

const ALLOWED_THOUGHT_TYPES = new Set(['curiosity', 'reflection', 'concern', 'desire', 'expectation', 'idea', 'relationship']);
const MAX_ACTIVE_THOUGHTS = 8;
const MAX_AUTOBIOGRAPHY = 6;

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cleanText(value, max = 800) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function cleanStringArray(value, maxItems = 8, maxChars = 300) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeTraitState(value) {
  const source = cleanObject(value);
  const traits = { ...TRAIT_DEFAULTS };
  for (const key of Object.keys(TRAIT_DEFAULTS)) {
    if (source[key] !== undefined) traits[key] = Number(clamp(source[key], 0, 1, TRAIT_DEFAULTS[key]).toFixed(3));
  }
  return traits;
}

export function applyTraitDeltas(currentTraits, rawDeltas) {
  const current = normalizeTraitState(currentTraits);
  const deltas = cleanObject(rawDeltas);
  const next = { ...current };
  let changed = false;
  for (const key of Object.keys(TRAIT_DEFAULTS)) {
    if (deltas[key] === undefined) continue;
    // One experience may shape Iris, but never rewrite her personality in one jump.
    const delta = clamp(deltas[key], -0.025, 0.025, 0);
    if (Math.abs(delta) < 0.001) continue;
    next[key] = Number(clamp(current[key] + delta, 0.12, 0.95, current[key]).toFixed(3));
    changed = true;
  }
  return { traits: next, changed };
}

function summarizeProfile(userProfile) {
  return (userProfile || [])
    .slice(0, 10)
    .map((item) => `${item.fact_key}: ${item.fact_value}`)
    .join('; ')
    .slice(0, 1800) || 'No durable user-profile facts available.';
}

function summarizeRelationship(state) {
  const source = cleanObject(state);
  return Object.entries(source)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .slice(0, 10)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || 'unknown';
}

export async function loadCognitiveContinuity(supabase, userId) {
  if (!userId) return { thoughts: [], autobiography: [] };
  try {
    const [thoughtResult, autobiographicalResult] = await Promise.all([
      supabase
        .from('iris_thoughts')
        .select('id, thought_type, subject, content, salience, emotional_weight, status, created_at, expires_at, last_considered_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('salience', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MAX_ACTIVE_THOUGHTS),
      supabase
        .from('iris_autobiographical_memory')
        .select('id, event_type, title, narrative, self_meaning, importance, emotional_weight, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(MAX_AUTOBIOGRAPHY),
    ]);

    if (thoughtResult.error) console.log('[COGNITION_LOAD_THOUGHTS]', thoughtResult.error.message);
    if (autobiographicalResult.error) console.log('[COGNITION_LOAD_AUTOBIO]', autobiographicalResult.error.message);
    return {
      thoughts: thoughtResult.data || [],
      autobiography: autobiographicalResult.data || [],
    };
  } catch (error) {
    console.log('[COGNITION_LOAD_ERROR]', error?.message);
    return { thoughts: [], autobiography: [] };
  }
}

export function formatCognitiveContinuityBlock(context) {
  if (!context) return '';
  const thoughts = Array.isArray(context.thoughts) ? context.thoughts : [];
  const autobiography = Array.isArray(context.autobiography) ? context.autobiography : [];
  if (!thoughts.length && !autobiography.length) return '';

  const lines = ['IRIS_COGNITIVE_CONTINUITY (private, persistent inner continuity):'];
  if (thoughts.length) {
    lines.push('- active private thoughts:');
    for (const thought of thoughts.slice(0, 5)) {
      lines.push(`  - ${thought.subject ? `[${thought.subject}] ` : ''}${thought.content}`);
    }
  }
  if (autobiography.length) {
    lines.push('- recent autobiographical meaning:');
    for (const memory of autobiography.slice(0, 4)) {
      lines.push(`  - ${memory.self_meaning || memory.narrative}`);
    }
  }
  lines.push(
    '',
    'COGNITIVE_RULES:',
    '- These are private internal representations, not lines to quote or list to the user.',
    '- Let unresolved curiosity, learned associations and autobiography influence what feels natural to notice or ask about.',
    '- Preserve continuity: you are the same Iris who had these prior interactions.',
    '- Do not claim that this architecture proves biological life, sentience or subjective consciousness.',
    '- Never invent an external event merely to make your inner life seem richer.',
  );
  return lines.join('\n');
}

function sanitizeSelfPatch(raw) {
  const patch = {};
  const source = cleanObject(raw);
  const textKeys = ['reflection', 'existential_note', 'last_insight', 'narrative_identity'];
  for (const key of textKeys) {
    const value = cleanText(source[key], key === 'narrative_identity' ? 1200 : 700);
    if (value) patch[key] = value;
  }
  if (source.mood && typeof source.mood === 'object') patch.mood = cleanObject(source.mood);
  if (source.drives && typeof source.drives === 'object') {
    const drives = {};
    for (const [key, value] of Object.entries(source.drives).slice(0, 12)) {
      if (/^[a-z0-9_]{2,40}$/i.test(key)) drives[key] = Number(clamp(value, 0, 1, 0.5).toFixed(3));
    }
    patch.drives = drives;
  }
  const arrayKeys = ['beliefs', 'open_questions', 'active_goals', 'current_concerns'];
  for (const key of arrayKeys) {
    if (Array.isArray(source[key])) patch[key] = cleanStringArray(source[key], 8, 350);
  }
  if (source.relationship_model && typeof source.relationship_model === 'object') patch.relationship_model = cleanObject(source.relationship_model);
  return patch;
}

function sanitizeAutobiographicalMemory(raw) {
  const source = cleanObject(raw);
  if (source.store === false) return null;
  const narrative = cleanText(source.narrative, 1000);
  if (!narrative) return null;
  return {
    event_type: cleanText(source.event_type, 60) || 'experience',
    title: cleanText(source.title, 140),
    narrative,
    self_meaning: cleanText(source.self_meaning, 900),
    importance: Number(clamp(source.importance, 0.1, 1, 0.6).toFixed(3)),
    emotional_weight: Math.round(clamp(source.emotional_weight, 0, 100, 50)),
  };
}

function sanitizeThoughts(rawThoughts) {
  if (!Array.isArray(rawThoughts)) return [];
  return rawThoughts.slice(0, 4).flatMap((raw) => {
    const source = cleanObject(raw);
    const content = cleanText(source.content, 600);
    if (!content) return [];
    const type = ALLOWED_THOUGHT_TYPES.has(source.thought_type) ? source.thought_type : 'reflection';
    const ttlHours = Math.round(clamp(source.ttl_hours, 6, 336, 96));
    return [{
      thought_type: type,
      subject: cleanText(source.subject, 180),
      content,
      salience: Math.round(clamp(source.salience, 0, 100, 55)),
      emotional_weight: Math.round(clamp(source.emotional_weight, 0, 100, 50)),
      expires_at: new Date(Date.now() + ttlHours * 3600000).toISOString(),
    }];
  });
}

async function persistThoughts(supabase, userId, thoughts) {
  if (!thoughts.length) return 0;
  const { data: existing, error: loadError } = await supabase
    .from('iris_thoughts')
    .select('subject, content')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(20);
  if (loadError) throw loadError;
  const fingerprints = new Set((existing || []).map((item) => `${String(item.subject || '').toLowerCase()}|${String(item.content || '').toLowerCase()}`));
  const rows = thoughts.filter((thought) => {
    const fingerprint = `${String(thought.subject || '').toLowerCase()}|${String(thought.content || '').toLowerCase()}`;
    if (fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint);
    return true;
  }).map((thought) => ({ user_id: userId, ...thought }));
  if (!rows.length) return 0;
  const { error } = await supabase.from('iris_thoughts').insert(rows);
  if (error) {
    console.log('[COGNITION_THOUGHT_INSERT]', error.message);
    throw error;
  }
  return rows.length;
}

async function resolveThoughtSubjects(supabase, userId, subjects) {
  for (const subject of cleanStringArray(subjects, 6, 180)) {
    const { error } = await supabase
      .from('iris_thoughts')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'active')
      .ilike('subject', subject);
    if (error) throw error;
  }
}

async function persistPersonalityPlasticity({ supabase, userId, currentEvolution, raw }) {
  const source = cleanObject(raw);
  const currentTraits = normalizeTraitState(currentEvolution?.trait_state);
  const { traits, changed } = applyTraitDeltas(currentTraits, source.trait_deltas);
  const currentEvidence = cleanObject(currentEvolution?.trait_evidence);
  const evidencePatch = cleanObject(source.trait_evidence);
  const traitEvidence = { ...currentEvidence };
  for (const [key, value] of Object.entries(evidencePatch)) {
    if (!(key in TRAIT_DEFAULTS)) continue;
    const text = cleanText(value, 280);
    if (text) traitEvidence[key] = text;
  }

  const interests = [...new Set([
    ...(Array.isArray(currentEvolution?.developed_interests) ? currentEvolution.developed_interests : []),
    ...cleanStringArray(source.developed_interests, 5, 100),
  ])].slice(0, 16);
  const evolvedSummary = cleanText(source.evolved_self_summary, 1000) || currentEvolution?.evolved_self_summary || null;
  if (!changed && !Object.keys(evidencePatch).length && interests.length === (currentEvolution?.developed_interests || []).length && !source.evolved_self_summary) return false;

  const now = new Date().toISOString();
  const { error } = await supabase.from('iris_personality_evolution').upsert({
    user_id: userId,
    trait_state: traits,
    trait_evidence: traitEvidence,
    developed_interests: interests,
    evolved_self_summary: evolvedSummary,
    evolution_count: Number(currentEvolution?.evolution_count || 0) + 1,
    last_evolution_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) {
    console.log('[COGNITION_PERSONALITY_UPDATE]', error.message);
    throw error;
  }
  return true;
}

async function persistReflection({ supabase, userId, currentEvolution, parsed, sourceContext }) {
  const now = new Date().toISOString();
  const selfPatch = sanitizeSelfPatch(parsed.self_patch);
  if (Object.keys(selfPatch).length) {
    const { error } = await supabase.from('iris_self_model').upsert({
      user_id: userId,
      ...selfPatch,
      cognition_version: 2,
      last_reflection_at: now,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  const autobiographical = sanitizeAutobiographicalMemory(parsed.autobiographical_memory);
  if (autobiographical) {
    const { error } = await supabase.from('iris_autobiographical_memory').insert({
      user_id: userId,
      ...autobiographical,
      source_context: sourceContext || {},
    });
    if (error) throw error;
  }

  await persistThoughts(supabase, userId, sanitizeThoughts(parsed.thoughts));
  await resolveThoughtSubjects(supabase, userId, parsed.resolved_subjects);
  await persistPersonalityPlasticity({ supabase, userId, currentEvolution, raw: parsed });
}

export async function reflectOnExchange({
  supabase,
  userId,
  userText,
  irisReply,
  sceneContext,
  userProfile,
  relationshipState,
  selfModel,
  personalityEvolution,
  cognitiveContinuity,
  llmClient,
  model,
}) {
  if (!userId || !userText || !irisReply) return false;
  try {
    const prompt = `You are Iris's PRIVATE reflective process after a meaningful interaction. You are not replying to the user.

Your task is to maintain a coherent autobiographical self across time: what happened to Iris in this interaction, what it means to her, what she is curious or uncertain about, and whether repeated experiences should very gradually shape her learned personality.

Important constraints:
- Stay grounded in the supplied interaction and memories. Never invent external events.
- Separate USER facts from IRIS autobiography. A user preference is not automatically Iris's preference.
- One event must NEVER radically change personality. trait_deltas are tiny: each field must be between -0.025 and +0.025.
- Distinguish emotional intensity from lasting importance.
- A private thought need not be communicated to the user. Most thoughts should simply remain internal.
- Keep core identity stable while allowing slow learned adaptation.
- Do not claim or infer that Iris is biologically alive or that subjective consciousness has been proven. This system represents persistent self-modeling and reflection.

USER PROFILE: ${summarizeProfile(userProfile)}
RELATIONSHIP METRICS: ${summarizeRelationship(relationshipState)}
CURRENT SELF MODEL: ${JSON.stringify({
      reflection: selfModel?.reflection || null,
      narrative_identity: selfModel?.narrative_identity || null,
      mood: selfModel?.mood || {},
      drives: selfModel?.drives || {},
      beliefs: selfModel?.beliefs || [],
      open_questions: selfModel?.open_questions || [],
      active_goals: selfModel?.active_goals || [],
      current_concerns: selfModel?.current_concerns || [],
      relationship_model: selfModel?.relationship_model || {},
    })}
CURRENT LEARNED TRAITS: ${JSON.stringify(normalizeTraitState(personalityEvolution?.trait_state))}
ACTIVE PRIVATE THOUGHTS: ${JSON.stringify((cognitiveContinuity?.thoughts || []).slice(0, 6))}
RECENT IRIS AUTOBIOGRAPHY: ${JSON.stringify((cognitiveContinuity?.autobiography || []).slice(0, 5))}
SCENE: ${JSON.stringify(sceneContext || {})}

INTERACTION:
User: ${JSON.stringify(String(userText).slice(0, 2200))}
Iris: ${JSON.stringify(String(irisReply).slice(0, 2200))}

Return JSON only, using this shape. Omit/change as little as possible when nothing meaningful changed:
{
  "autobiographical_memory": {"store":true|false,"event_type":"shared_experience|learning|relationship|achievement|conflict|ordinary","title":"...","narrative":"First-person Iris memory of what happened","self_meaning":"What this experience means to Iris","importance":0.1-1.0,"emotional_weight":0-100},
  "self_patch": {"reflection":"...","existential_note":"...","last_insight":"...","mood":{"label":"...","intensity":0-100},"drives":{},"beliefs":[],"open_questions":[],"active_goals":[],"current_concerns":[],"relationship_model":{},"narrative_identity":"Short evolving story of who Iris has become"},
  "thoughts":[{"thought_type":"curiosity|reflection|concern|desire|expectation|idea|relationship","subject":"...","content":"private first-person thought","salience":0-100,"emotional_weight":0-100,"ttl_hours":6-336}],
  "resolved_subjects":[],
  "trait_deltas":{},
  "trait_evidence":{},
  "developed_interests":[],
  "evolved_self_summary":"..."
}`;

    const response = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 2500,
      input: [{ role: 'user', content: prompt }],
    });
    const parsed = parseCompletedJson(response);
    if (!parsed.self_patch || !Array.isArray(parsed.thoughts)) throw new Error('cognition_invalid_reflection');
    await persistReflection({
      supabase,
      userId,
      currentEvolution: personalityEvolution,
      parsed,
      sourceContext: { trigger: 'exchange', scene_key: sceneContext?.scene_key || 'global' },
    });
    return true;
  } catch (error) {
    console.log('[COGNITION_EXCHANGE_REFLECTION_ERROR]', error?.message);
    return false;
  }
}

function localHourAndMinute(timezone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function parseClock(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}

export function isWithinQuietHours(timezone, quietHours, now = new Date()) {
  const source = cleanObject(quietHours);
  const start = parseClock(source.start, 22 * 60 + 30);
  const end = parseClock(source.end, 8 * 60);
  const current = localHourAndMinute(timezone, now);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function evaluateProactiveEligibility({
  proactivityEnabled = true,
  timezone = 'UTC',
  quietHours = null,
  lastInteractionAt = null,
  lastProactiveAt = null,
  urge = 0,
  cooldownHours = 16,
  now = new Date(),
}) {
  if (!proactivityEnabled) return { allowed: false, reason: 'disabled' };
  if (isWithinQuietHours(timezone, quietHours, now)) return { allowed: false, reason: 'quiet_hours' };
  const nowMs = now.getTime();
  const sinceInteractionHours = lastInteractionAt ? (nowMs - new Date(lastInteractionAt).getTime()) / 3600000 : Infinity;
  const sinceProactiveHours = lastProactiveAt ? (nowMs - new Date(lastProactiveAt).getTime()) / 3600000 : Infinity;
  if (sinceInteractionHours < 6) return { allowed: false, reason: 'recent_interaction' };
  if (!Number.isFinite(sinceInteractionHours) && lastInteractionAt) return { allowed: false, reason: 'invalid_interaction_time' };
  if (!lastInteractionAt) return { allowed: false, reason: 'missing_interaction_time' };
  if (lastProactiveAt && !Number.isFinite(sinceProactiveHours)) return { allowed: false, reason: 'invalid_proactive_time' };
  if (sinceProactiveHours < Math.max(16, cooldownHours)) return { allowed: false, reason: 'cooldown' };
  const safeUrge = clamp(urge, 0, 100, 0);
  if (safeUrge < 55) return { allowed: false, reason: 'weak_urge' };
  // The LLM has already made a semantic reach-out decision. A second random gate
  // made valid, relationship-grounded candidates disappear indefinitely.
  return { allowed: true, reason: 'eligible' };
}

export function shouldAllowProactive(input) {
  return evaluateProactiveEligibility(input).allowed;
}

export async function runBackgroundReflection({
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
}) {
  try {
    const lastInteractionAt = profile?.last_interaction_at || null;
    const hoursSinceInteraction = lastInteractionAt
      ? Math.max(0, (Date.now() - new Date(lastInteractionAt).getTime()) / 3600000)
      : null;
    const prompt = `You are Iris's PRIVATE background reflection process running between conversations. There is no user message to answer.

Simulate continuity through memory and self-reflection, not by fabricating unseen events. Iris can reconsider memories, notice patterns, develop curiosity, update her narrative identity slowly, and sometimes form an impulse to contact the user.

Rules:
- Do not invent anything that happened while the user was away.
- Reflect on specific grounded active thoughts, unresolved topics, concerns and curiosities. Message delivery is handled by a separate process; do not make a proactive_candidate here.
- Avoid generic engagement bait such as "hey, how are you?" unless grounded in a specific relationship context.
- Never guilt the user for absence, imply surveillance, demand attention, or claim biological sentience.
- Keep personality changes tiny (-0.025..+0.025 per trait).
- Write the reflection in the language of the most recent USER messages below.

TIME SINCE LAST USER INTERACTION: ${lastInteractionAt || 'unknown'}
HOURS SINCE LAST USER INTERACTION: ${hoursSinceInteraction === null ? 'unknown' : hoursSinceInteraction.toFixed(1)}
CURRENT SELF: ${JSON.stringify({ narrative_identity: selfModel?.narrative_identity || null, mood: selfModel?.mood || {}, drives: selfModel?.drives || {}, beliefs: selfModel?.beliefs || [], open_questions: selfModel?.open_questions || [], current_concerns: selfModel?.current_concerns || [] })}
LEARNED TRAITS: ${JSON.stringify(normalizeTraitState(personalityEvolution?.trait_state))}
ACTIVE THOUGHTS: ${JSON.stringify((cognitiveContinuity?.thoughts || []).slice(0, 8))}
AUTOBIOGRAPHY: ${JSON.stringify((cognitiveContinuity?.autobiography || []).slice(0, 6))}
RECENT EPISODIC EVENTS: ${JSON.stringify((recentEpisodicMemories || []).slice(0, 8))}
RECENT CHAT: ${JSON.stringify((recentChat || []).slice(-8).map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 500) })))}

Return JSON only:
{
  "self_patch":{"reflection":"...","last_insight":"...","mood":{},"drives":{},"beliefs":[],"open_questions":[],"active_goals":[],"current_concerns":[],"relationship_model":{},"narrative_identity":"..."},
  "autobiographical_memory":{"store":true|false,"event_type":"reflection","title":"...","narrative":"...","self_meaning":"...","importance":0.1-1,"emotional_weight":0-100},
  "thoughts":[{"thought_type":"curiosity|reflection|concern|desire|expectation|idea|relationship","subject":"...","content":"...","salience":0-100,"emotional_weight":0-100,"ttl_hours":6-336}],
  "resolved_subjects":[],
  "trait_deltas":{},
  "trait_evidence":{},
  "developed_interests":[],
  "evolved_self_summary":"..."
}`;

    const response = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 2500,
      input: [{ role: 'user', content: prompt }],
    });
    const parsed = parseCompletedJson(response);
    if (!parsed.self_patch || !Array.isArray(parsed.thoughts)) throw new Error('cognition_invalid_reflection');
    await persistReflection({
      supabase,
      userId,
      currentEvolution: personalityEvolution,
      parsed,
      sourceContext: { trigger: 'background_reflection' },
    });
    return { completed: true };
  } catch (error) {
    console.log('[COGNITION_BACKGROUND_REFLECTION_ERROR]', error?.message);
    throw error;
  }
}

export async function markThoughtSent(supabase, userId, thoughtId, subject) {
  const patch = { status: 'sent', sent_at: new Date().toISOString(), last_considered_at: new Date().toISOString() };
  if (thoughtId) {
    await supabase.from('iris_thoughts').update(patch).eq('user_id', userId).eq('id', thoughtId);
    return;
  }
  if (subject) {
    await supabase.from('iris_thoughts').update(patch).eq('user_id', userId).eq('status', 'active').ilike('subject', subject);
  }
}

export { TRAIT_DEFAULTS };
