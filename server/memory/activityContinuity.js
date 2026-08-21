function cleanText(value, max = 300) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function cleanArray(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item)).filter(Boolean))].slice(0, maxItems);
}

export function sanitizeActivityState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    current_activity: cleanText(source.current_activity),
    next_steps: cleanArray(source.next_steps),
    commitments: cleanArray(source.commitments),
    pending_promises: cleanArray(source.pending_promises),
  };
}

export async function loadActivityState(supabase, userId) {
  if (!supabase || !userId) return sanitizeActivityState(null);
  try {
    const { data, error } = await supabase
      .from('iris_activity_state')
      .select('current_activity, next_steps, commitments, pending_promises, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.log('[ACTIVITY_STATE_LOAD]', error.message);
      return sanitizeActivityState(null);
    }
    return { ...sanitizeActivityState(data), updated_at: data?.updated_at || null };
  } catch (error) {
    console.log('[ACTIVITY_STATE_LOAD]', error?.message);
    return sanitizeActivityState(null);
  }
}

export async function persistActivityStateSignal({ supabase, userId, intent, currentActivityState = null }) {
  if (!supabase || !userId || !intent) return currentActivityState || sanitizeActivityState(null);
  const confidence = Math.max(0, Math.min(1, Number(intent.activity_confidence || 0)));
  if (confidence < 0.55 || !intent.activity_state || typeof intent.activity_state !== 'object') {
    return currentActivityState || sanitizeActivityState(null);
  }
  const next = sanitizeActivityState(intent.activity_state);
  const now = new Date().toISOString();
  const { error } = await supabase.from('iris_activity_state').upsert({
    user_id: userId,
    ...next,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) {
    console.log('[ACTIVITY_STATE_UPSERT]', error.message);
    return currentActivityState || sanitizeActivityState(null);
  }
  return { ...next, updated_at: now };
}

export function formatActivityStateBlock(activityState) {
  const state = sanitizeActivityState(activityState);
  if (!state.current_activity && !state.next_steps.length && !state.commitments.length && !state.pending_promises.length) return '';
  const lines = ['IRIS_ACTIVITY_CONTINUITY (current commitments and ordered plan):'];
  if (state.current_activity) lines.push(`- current_activity: ${state.current_activity}`);
  if (state.next_steps.length) lines.push(`- next_steps_in_order: ${state.next_steps.join(' -> ')}`);
  if (state.commitments.length) lines.push(`- commitments: ${state.commitments.join(' | ')}`);
  if (state.pending_promises.length) lines.push(`- pending_promises: ${state.pending_promises.join(' | ')}`);
  lines.push(
    'RULES:',
    '- Preserve the order of established plans. Do not silently reorder, repeat, skip or retroactively redo an activity.',
    '- A question or suggestion from the user is not automatically a new commitment.',
    '- Conditional language such as maybe/perhaps is not a firm plan until Iris actually commits to it.',
    '- Do not invent a new destination or activity merely to make the conversation sound lively.',
    '- If Iris changes her mind, say so naturally and update the plan rather than pretending the new plan was always true.',
    '- Never claim a pending promise has been fulfilled until the corresponding action actually happened.',
  );
  return lines.join('\n');
}
