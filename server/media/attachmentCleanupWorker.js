import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { CHAT_ATTACHMENT_BUCKET } from './chatAttachments.js';

let timer = null;
let running = false;

function cleanupIntervalMs() {
  const hours = Number(process.env.CHAT_ATTACHMENT_CLEANUP_HOURS || 6);
  return Math.max(1, Math.min(Number.isFinite(hours) ? hours : 6, 24)) * 60 * 60 * 1000;
}

export async function runAttachmentCleanupSweep(limit = 200) {
  if (running) return { skipped: 'already_running', deleted: 0 };
  running = true;
  try {
    const admin = getSupabaseAdmin();
    const { data: rows, error } = await admin
      .from('chat_attachments')
      .select('id, bucket, path')
      .not('expires_at', 'is', null)
      .lte('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true })
      .limit(Math.max(1, Math.min(Number(limit) || 200, 1000)));
    if (error) throw error;
    if (!rows?.length) return { processed: 0, deleted: 0 };

    const supported = rows.filter((row) => row.bucket === CHAT_ATTACHMENT_BUCKET);
    if (supported.length) {
      const { error: removeError } = await admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove(supported.map((row) => row.path));
      if (removeError) throw removeError;
      const { error: deleteError } = await admin.from('chat_attachments').delete().in('id', supported.map((row) => row.id));
      if (deleteError) throw deleteError;
    }
    console.log('[ATTACHMENT_CLEANUP_SWEEP]', { processed: rows.length, deleted: supported.length });
    return { processed: rows.length, deleted: supported.length };
  } catch (error) {
    console.log('[ATTACHMENT_CLEANUP_ERROR]', error?.message || error);
    return { processed: 0, deleted: 0, error: error?.message || String(error) };
  } finally {
    running = false;
  }
}

export function startAttachmentCleanupLoop() {
  if (timer) return false;
  const interval = cleanupIntervalMs();
  const firstRun = setTimeout(() => runAttachmentCleanupSweep().catch(() => {}), 30000);
  firstRun.unref?.();
  timer = setInterval(() => runAttachmentCleanupSweep().catch(() => {}), interval);
  timer.unref?.();
  console.log('[ATTACHMENT_CLEANUP_LOOP_STARTED]', { intervalHours: interval / 3600000 });
  return true;
}
