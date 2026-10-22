// Generic durable job queue backed by public.iris_jobs. Handlers are registered by kind, so new
// autonomous behaviors plug in without touching the runner.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

const handlers = new Map();
let timer = null;
let running = false;

function intEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export function registerJobHandler(kind, handler) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(kind)) throw new Error(`invalid_job_kind:${kind}`);
  handlers.set(kind, handler);
}

// Duplicate dedupe keys are expected (idempotent scheduling) and are not errors.
export async function enqueueJob(admin, { userId = null, kind, payload = {}, runAt = new Date(), dedupeKey = null, maxAttempts = 3 }) {
  const { data, error } = await admin
    .from('iris_jobs')
    .upsert({
      user_id: userId,
      kind,
      payload,
      run_at: new Date(runAt).toISOString(),
      dedupe_key: dedupeKey,
      max_attempts: maxAttempts,
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id || null;
}

function backoffMs(attempts) {
  return Math.min(6 * 3600000, 2 ** Math.max(0, attempts - 1) * 5 * 60000);
}

async function finishJob(admin, job, outcome) {
  const now = new Date();
  const patch = outcome.ok
    ? { status: 'done', result: outcome.result ?? null, finished_at: now.toISOString(), lease_until: null, last_error: null }
    : job.attempts >= job.max_attempts || outcome.terminal
      ? { status: 'failed', finished_at: now.toISOString(), lease_until: null, last_error: String(outcome.error || 'failed').slice(0, 500) }
      : { status: 'pending', run_at: new Date(now.getTime() + backoffMs(job.attempts)).toISOString(), lease_until: null, last_error: String(outcome.error || 'retry').slice(0, 500) };
  const { error } = await admin.from('iris_jobs').update(patch).eq('id', job.id).eq('status', 'running');
  if (error) console.log('[JOB_FINISH_ERROR]', job.id, error.message);
}

export async function runJobSweep() {
  if (running) return { skipped: 'already_running' };
  running = true;
  const admin = getSupabaseAdmin();
  let processed = 0;
  try {
    const { data: jobs, error } = await admin.rpc('claim_iris_jobs', {
      p_limit: intEnv('IRIS_JOB_BATCH', 5, 1, 50),
      p_lease_seconds: intEnv('IRIS_JOB_LEASE_SECONDS', 300, 30, 3600),
    });
    if (error) throw error;
    for (const job of jobs || []) {
      const handler = handlers.get(job.kind);
      if (!handler) {
        await finishJob(admin, job, { ok: false, terminal: true, error: `no_handler:${job.kind}` });
        continue;
      }
      try {
        const result = await handler({ admin, job });
        await finishJob(admin, job, { ok: true, result });
      } catch (handlerError) {
        console.log('[JOB_HANDLER_ERROR]', { kind: job.kind, id: job.id, error: handlerError?.code || handlerError?.message });
        await finishJob(admin, job, { ok: false, terminal: Boolean(handlerError?.terminal), error: handlerError?.code || handlerError?.message });
      }
      processed += 1;
    }
    return { processed };
  } catch (error) {
    console.log('[JOB_SWEEP_ERROR]', error?.message || error);
    return { processed, error: error?.message };
  } finally {
    running = false;
  }
}

export function startJobLoop() {
  if (timer || String(process.env.IRIS_JOBS_ENABLED || 'true').toLowerCase() === 'false') return false;
  const intervalMs = intEnv('IRIS_JOB_POLL_SECONDS', 30, 10, 600) * 1000;
  timer = setInterval(() => { void runJobSweep(); }, intervalMs);
  timer.unref?.();
  console.log('[JOB_LOOP_STARTED]', { pollSeconds: intervalMs / 1000, kinds: [...handlers.keys()] });
  return true;
}
