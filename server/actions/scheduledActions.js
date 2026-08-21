function clampDelayMinutes(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(3, Math.min(180, Math.round(parsed)));
}

function compactHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().slice(0, 1200),
    }))
    .filter((item) => item.content);
}

export async function scheduleImageAction({
  supabase,
  userId,
  delayMinutes,
  requestText,
  conversationHistory = [],
  visualState = null,
  physicalIdentity = null,
  activityState = null,
  sceneContext = null,
}) {
  const delay = clampDelayMinutes(delayMinutes);
  const dueAt = new Date(Date.now() + delay * 60000).toISOString();
  const { data, error } = await supabase.from('iris_scheduled_actions').insert({
    user_id: userId,
    action_type: 'image',
    status: 'pending',
    due_at: dueAt,
    request_text: String(requestText || '').trim().slice(0, 4000),
    conversation_snapshot: compactHistory(conversationHistory),
    visual_state_snapshot: visualState || {},
    physical_identity_snapshot: physicalIdentity || {},
    activity_snapshot: activityState || {},
    scene_context_snapshot: sceneContext || {},
  }).select('id, due_at, action_type, status').maybeSingle();
  if (error) throw new Error(error.message);
  return { ...data, delay_minutes: delay };
}

export function formatScheduledActionDirective(action) {
  if (!action?.id || action.action_type !== 'image') return '';
  return `SCHEDULED_ACTION_INTERNAL:\n- A real image delivery has been queued by the backend.\n- It is due in about ${action.delay_minutes} minutes.\n- You may naturally tell the user you will send the photo later/after the relevant activity because the action is actually scheduled.\n- Do not claim it has already been sent.\n- Do not invent additional future activities around it.`;
}

export async function loadDueScheduledActions(supabase, limit = 10) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
  const { data, error } = await supabase
    .from('iris_scheduled_actions')
    .select('*')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function claimScheduledAction(supabase, actionId) {
  const { data, error } = await supabase
    .from('iris_scheduled_actions')
    .update({ status: 'processing', claimed_at: new Date().toISOString(), failure_reason: null })
    .eq('id', actionId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function completeScheduledAction(supabase, actionId) {
  const { error } = await supabase
    .from('iris_scheduled_actions')
    .update({ status: 'sent', completed_at: new Date().toISOString(), failure_reason: null })
    .eq('id', actionId);
  if (error) throw new Error(error.message);
}

export async function failScheduledAction(supabase, actionId, reason) {
  const { error } = await supabase
    .from('iris_scheduled_actions')
    .update({ status: 'failed', completed_at: new Date().toISOString(), failure_reason: String(reason || 'unknown').slice(0, 500) })
    .eq('id', actionId);
  if (error) console.log('[SCHEDULED_ACTION_FAIL_UPDATE]', error.message);
}
