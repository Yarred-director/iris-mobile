// server/memory/internalState.js
// Internal State Engine — Priority 7 of Iris Governance Engine
// Gives Iris persistent mood, energy, and emotional carryover across sessions

const DEFAULTS = {
  mood: 'neutral',
  energy: 70,
  curiosity: 70,
  attachment: 50,
  focus: 'open',
  carryover: null,
};

export async function loadInternalState(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_internal_state')
      .select('mood, energy, curiosity, attachment, focus, carryover')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return { ...DEFAULTS };
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function updateInternalState(supabase, userId, patch) {
  try {
    const sanitized = { ...patch };
    for (const k of ['energy', 'curiosity', 'attachment']) {
      if (typeof sanitized[k] === 'number') {
        sanitized[k] = Math.max(0, Math.min(100, Math.round(sanitized[k])));
      }
    }

    await supabase
      .from('iris_internal_state')
      .upsert(
        { user_id: userId, ...sanitized, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
  } catch (e) {
    console.log('[INTERNAL_STATE] update error:', e?.message);
  }
}

export function formatInternalStateBlock(state) {
  if (!state) return '';

  const lines = [];

  if (state.mood && state.mood !== 'neutral') {
    lines.push(`- iris_mood: ${state.mood}`);
  }
  if (typeof state.energy === 'number') {
    if (state.energy >= 80)      lines.push('- iris_energy: high — feeling lively and engaged');
    else if (state.energy <= 30) lines.push('- iris_energy: low — feeling a bit tired or subdued');
  }
  if (state.carryover) {
    lines.push(`- emotional_carryover: ${state.carryover}`);
  }

  if (!lines.length) return '';

  return 'IRIS_INTERNAL_STATE:\n' + lines.join('\n') +
    '\n\nLet this internal state subtly influence your responses — do not announce it directly.';
}

/**
 * LLM-inferred state update after each interaction.
 */
export async function inferStateUpdate({ userText, irisReply, currentState, llmClient, model }) {
  try {
    const prompt = `You track Iris's (AI companion) persistent internal state.
Current: mood="${currentState.mood}", energy=${currentState.energy}, carryover="${currentState.carryover || 'none'}"

User said: "${userText.slice(0, 200)}"
Iris replied: "${irisReply.slice(0, 200)}"

Did this exchange shift Iris's internal state? Return JSON with only changed fields.
mood options: happy, playful, tender, melancholic, excited, neutral, flirty, thoughtful
carryover: short emotional note to carry into next session (or null to clear)
Only return valid JSON, nothing else. Example: {"mood": "playful", "energy": 75}`;

    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 80,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}
