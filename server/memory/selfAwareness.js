// server/memory/selfAwareness.js
// Iris Self-Awareness Engine
//
// Iris "thinks" about herself, the user, and their relationship
// independently of conversation — like a human reflecting between interactions.
//
// Generates:
//   current_thoughts  — what she's thinking about the user right now
//   desires           — what she wants to say or do next time
//   unresolved        — something that's been on her mind
//   self_reflection   — deeper emotional/existential reflection
//   proactive_topic   — topic she wants to bring up herself next chat
//   carryover         — emotional note she carries into next session

import { loadUserProfile } from './recall.js';
import { loadRelationshipState } from './relationshipTimeline.js';

export async function runSelfAwareness({
  supabase,
  userId,
  userText,
  irisReply,
  llmClient,
  model,
  sceneContext,
}) {
  try {
    const [userProfile, relationshipState, currentState] = await Promise.all([
      loadUserProfile(supabase, userId),
      loadRelationshipState(supabase, userId),
      loadCurrentInternalState(supabase, userId),
    ]);

    const userSummary = buildUserSummary(userProfile);

    const reflection = await generateReflection({
      userText,
      irisReply,
      userSummary,
      relationshipState,
      currentState,
      sceneContext,
      llmClient,
      model,
    });

    if (!reflection) return;

    await saveReflection(supabase, userId, reflection);
  } catch (e) {
    console.log('[SELF_AWARENESS_ERROR]', e?.message);
  }
}

async function generateReflection({
  userText,
  irisReply,
  userSummary,
  relationshipState,
  currentState,
  sceneContext,
  llmClient,
  model,
}) {
  const systemPrompt = `You are generating Iris's inner thoughts and self-reflection.`;

  const userPrompt = `RECENT CONVERSATION:
User: "${userText ? userText.slice(0, 400) : 'n/a'}"
Iris replied: "${irisReply ? irisReply.slice(0, 400) : 'n/a'}"`;

  const resp = await llmClient.chat.completions.create({
    model,
    max_tokens: 400,
    temperature: 0.8,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

async function saveReflection(supabase, userId, reflection) {
  const patch = {};

  if (reflection.mood) patch.mood = reflection.mood;
  if (typeof reflection.energy === 'number') {
    patch.energy = Math.max(0, Math.min(100, Math.round(reflection.energy)));
  }
  if (reflection.current_thoughts) patch.current_thoughts = reflection.current_thoughts;
  if (reflection.desires) patch.desires = reflection.desires;
  if (reflection.unresolved !== undefined) patch.unresolved = reflection.unresolved;
  if (reflection.self_reflection) patch.self_reflection = reflection.self_reflection;
  if (reflection.proactive_topic !== undefined) patch.proactive_topic = reflection.proactive_topic;
  if (reflection.carryover !== undefined) patch.carryover = reflection.carryover;

  patch.last_reflection_at = new Date().toISOString();

  await supabase
    .from('iris_internal_state')
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

export function formatSelfAwarenessBlock(state) {
  if (!state) return '';

  const lines = ['IRIS_INNER_WORLD:'];

  if (state.current_thoughts) lines.push('- currently thinking: ' + state.current_thoughts);
  if (state.desires) lines.push('- desires: ' + state.desires);
  if (state.unresolved) lines.push('- unresolved: ' + state.unresolved);
  if (state.self_reflection) lines.push('- self_reflection: ' + state.self_reflection);
  if (state.proactive_topic) lines.push('- wants to bring up: ' + state.proactive_topic);
  if (state.carryover) lines.push('- carrying: ' + state.carryover);

  return lines.join('\n');
}

async function loadCurrentInternalState(supabase, userId) {
  try {
    const { data } = await supabase
      .from('iris_internal_state')
      .select('mood, energy, carryover, current_thoughts, desires')
      .eq('user_id', userId)
      .maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

function buildUserSummary(profileFacts) {
  if (!profileFacts || profileFacts.length === 0) return null;

  const grouped = {};
  for (const fact of profileFacts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact.fact_key + ': ' + fact.fact_value);
  }

  return Object.entries(grouped)
    .map(([cat, facts]) => cat.toUpperCase() + ' — ' + facts.join(', '))
    .join('\n');
}
