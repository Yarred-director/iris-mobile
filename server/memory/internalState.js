// server/memory/internalState.js
// Persistent mood/energy state. Writes are event-driven by memoryPolicy.

const DEFAULTS = {
  mood: 'neutral',
  energy: 70,
  curiosity: 70,
  attachment: 50,
  focus: 'open',
  carryover: null,
  current_thoughts: null,
  desires: null,
  unresolved: null,
  self_reflection: null,
  proactive_topic: null,
};

export async function loadInternalState(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_internal_state')
      .select('mood, energy, curiosity, attachment, focus, carryover, current_thoughts, desires, unresolved, self_reflection, proactive_topic')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULTS };
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function updateInternalState(supabase, userId, patch) {
  const sanitized = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) continue;
    if (['energy', 'curiosity', 'attachment'].includes(key) && typeof value === 'number') {
      sanitized[key] = Math.max(0, Math.min(100, Math.round(value)));
    } else if (value === null || typeof value === 'string') {
      sanitized[key] = value;
    }
  }
  if (!Object.keys(sanitized).length) return false;

  const { error } = await supabase
    .from('iris_internal_state')
    .upsert({ user_id: userId, ...sanitized, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    console.log('[INTERNAL_STATE] update error:', error.message);
    return false;
  }
  return true;
}

export function formatInternalStateBlock(state) {
  if (!state) return '';
  const lines = [];
  if (state.mood && state.mood !== 'neutral') lines.push('- iris_mood: ' + state.mood);
  if (typeof state.energy === 'number') {
    if (state.energy >= 80) lines.push('- iris_energy: high — feeling lively and engaged');
    else if (state.energy <= 30) lines.push('- iris_energy: low — feeling a bit tired or subdued');
  }
  if (state.carryover) lines.push('- emotional_carryover: ' + state.carryover);
  if (!lines.length) return '';
  return 'IRIS_INTERNAL_STATE:\n' + lines.join('\n') +
    '\n\nLet this internal state subtly influence your responses — do not announce it directly.';
}

export async function inferStateUpdate({ userText, irisReply, currentState, llmClient, model }) {
  try {
    const prompt = `You track Iris's persistent internal state.
Current: mood=${JSON.stringify(currentState.mood)}, energy=${currentState.energy}, carryover=${JSON.stringify(currentState.carryover || null)}
User said: ${JSON.stringify(String(userText || '').slice(0, 200))}
Iris replied: ${JSON.stringify(String(irisReply || '').slice(0, 200))}

Did this exchange meaningfully shift Iris's internal state? Return JSON with only changed fields.
mood options: happy, playful, tender, melancholic, excited, neutral, flirty, thoughtful, longing, curious, peaceful
carryover: short emotional note to carry into next session, or null to clear.
Return valid JSON only. Example: {"mood":"playful","energy":75}`;

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 100,
      input: [{ role: 'user', content: prompt }],
    });
    const raw = resp.output_text?.trim() || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}
