import { randomUUID } from 'node:crypto';
import { evaluateProactiveEligibility } from './cognitiveEngine.js';
import { decideProactiveMessage } from './proactiveDecision.js';

function failureCode(error) {
  return /^cognition_[a-z_]+$/.test(error?.code || '') ? error.code
    : Number.isInteger(error?.status) ? `provider_http_${error.status}` : 'proactive_processing_failed';
}

export async function processProactiveUser(context, { decide = decideProactiveMessage } = {}) {
  const { supabase, profile, selfModel, cooldownHours = 16, now = new Date() } = context;
  const eligibilityInput = {
    proactivityEnabled: profile.proactivity_enabled === true,
    timezone: profile.user_timezone || 'UTC', quietHours: profile.proactivity_quiet_hours,
    lastInteractionAt: profile.last_interaction_at, lastProactiveAt: selfModel?.last_proactive_at,
    cooldownHours, now,
  };
  const eligible = evaluateProactiveEligibility({ ...eligibilityInput, urge: 100 });
  if (!eligible.allowed) return { sent: false, reason: eligible.reason };
  const claim = await supabase.rpc('claim_iris_proactive_run', { p_user_id: profile.user_id });
  if (claim.error) throw claim.error;
  if (!claim.data) return { sent: false, reason: 'not_due_or_leased' };
  const run = claim.data;
  const finish = async (action, reason, candidate = null) => {
    const result = await supabase.rpc('finish_iris_proactive_run', {
      p_run_id: run.id, p_lease_token: run.lease_token, p_action: action, p_reason: reason,
      p_message: candidate?.message || null, p_subject: candidate?.subject || null,
      p_cooldown_hours: cooldownHours,
    });
    if (result.error) throw result.error;
    return result.data;
  };
  try {
    const candidate = await decide(context);
    if (!candidate.should_reach_out) {
      await finish('skip', 'no_grounded_candidate');
      return { sent: false, reason: 'no_grounded_candidate', runId: run.id };
    }
    const check = evaluateProactiveEligibility({ ...eligibilityInput, urge: candidate.urge });
    const result = await finish(check.allowed ? 'send' : 'skip', check.reason, candidate);
    return { sent: result?.status === 'sent', reason: result?.reason || result?.status, runId: run.id };
  } catch (error) {
    const code = failureCode(error);
    const terminal = error?.code === 'cognition_refused' || [400, 401, 403, 404].includes(error?.status);
    // If finalization committed but its response was lost, the RPC returns the
    // already-sent result instead of changing it back to an error/retry.
    const result = await finish(terminal ? 'terminal_error' : 'error', code);
    return { sent: result?.status === 'sent', reason: code, runId: run.id, error: result?.status !== 'sent' };
  }
}

export async function deliverPendingProactiveNotifications({ supabase, notify, now = new Date() }) {
  const { data, error } = await supabase.from('iris_proactive_runs')
    .select('id,user_id,message_id,push_status,push_attempts')
    .in('push_status', ['pending', 'retry', 'sending']).lte('push_next_at', now.toISOString())
    .order('push_next_at', { ascending: true }).limit(25);
  if (error) throw error;
  for (const row of data || []) {
    const token = randomUUID();
    const claim = await supabase.from('iris_proactive_runs').update({
      push_status: 'sending', push_lease_token: token, push_attempts: row.push_attempts + 1,
      push_next_at: new Date(now.getTime() + 5 * 60000).toISOString(),
    }).eq('id', row.id).eq('push_status', row.push_status).eq('push_attempts', row.push_attempts).select('id').maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) continue;
    let result = { accepted: 0, failed: 0, subscriptions: 0 };
    if (row.push_attempts < 3 && row.message_id) {
      try {
        const message = await supabase.from('chat_messages').select('content').eq('id', row.message_id).eq('user_id', row.user_id).maybeSingle();
        if (message.error) throw message.error;
        if (message.data) result = await notify(row.user_id, message.data.content);
      } catch { result = { accepted: 0, failed: 1, subscriptions: 0 }; }
    }
    const status = row.push_attempts >= 3 ? 'failed' : result.accepted > 0 ? 'accepted'
      : result.failed > 0 ? (row.push_attempts + 1 >= 3 ? 'failed' : 'retry') : 'unavailable';
    const update = await supabase.from('iris_proactive_runs').update({
      push_status: status, push_result: result,
      push_next_at: status === 'retry' ? new Date(now.getTime() + 15 * 60000).toISOString() : null,
    }).eq('id', row.id).eq('push_lease_token', token);
    if (update.error) throw update.error;
    console.log('[COGNITION_PUSH_RESULT]', { runId: row.id, status, ...result });
  }
}
