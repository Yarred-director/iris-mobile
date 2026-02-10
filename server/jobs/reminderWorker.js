// server/jobs/reminderWorker.js
import { createClient } from '@supabase/supabase-js';
import { Expo } from 'expo-server-sdk';
import '../config/env.js';
import { sendExpoPush } from '../push/expoPush.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const expo = new Expo();

async function markFailed(reminder, send_error, send_details = null) {
  await supabase
    .from('reminders')
    .update({
      status: 'failed',
      updated_at: new Date().toISOString(),
      meta: {
        ...(reminder.meta || {}),
        send_error,
        send_details,
      },
    })
    .eq('id', reminder.id);

  console.log('[REMINDER] failed', reminder.id, send_error);
}

async function markQueuedAtomic(reminder, ticketIds, token) {
  // Atomic: pending -> queued only once (prevents infinite re-queue loops)
  const { error } = await supabase
    .from('reminders')
    .update({
      status: 'queued',
      updated_at: new Date().toISOString(),
      meta: {
        ...(reminder.meta || {}),
        push: {
          provider: 'expo',
          token_last4: token?.slice(-4) || null,
          ticket_ids: ticketIds,
          queued_at: new Date().toISOString(),
        },
      },
    })
    .eq('id', reminder.id)
    .eq('status', 'pending');

  if (error) {
    await markFailed(reminder, 'QUEUE_UPDATE_FAIL', error);
    return false;
  }

  console.log('[REMINDER] queued', reminder.id, ticketIds.length);
  return true;
}

async function markSent(reminder) {
  await supabase
    .from('reminders')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', reminder.id);

  console.log('[REMINDER] sent', reminder.id);
}

function extractTicketIds(send) {
  // Accept multiple possible shapes to avoid false NO_TICKET_ID
  const d = send?.details || send || {};

  if (Array.isArray(d.ticketIds) && d.ticketIds.length) return d.ticketIds.filter(Boolean);
  if (Array.isArray(d.ticket_ids) && d.ticket_ids.length) return d.ticket_ids.filter(Boolean);

  const tickets = d.tickets || d.data || d.messages;
  if (Array.isArray(tickets)) {
    const ids = tickets.map((t) => t?.id).filter(Boolean);
    if (ids.length) return ids;
  }

  if (typeof d.id === 'string' && d.id) return [d.id];

  return [];
}

async function processQueuedReceipts() {
  const { data: queued, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'queued')
    .order('due_at', { ascending: true })
    .limit(50);

  if (error) throw error;
  if (!queued?.length) return;

  for (const r of queued) {
    const ticketIds = r?.meta?.push?.ticket_ids;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      await markFailed(r, 'MISSING_TICKET_IDS', r?.meta?.push || null);
      continue;
    }

    try {
      const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
      let anyOk = false;
      let anyError = null;
      let lastDetails = null;

      for (const chunk of chunks) {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

        for (const receipt of Object.values(receipts || {})) {
          if (receipt?.status === 'ok') anyOk = true;
          if (receipt?.status === 'error') {
            anyError =
              receipt?.message || receipt?.details?.error || 'RECEIPT_ERROR';
            lastDetails = receipt;
          }
        }
      }

      if (anyError) await markFailed(r, anyError, lastDetails);
      else if (anyOk) await markSent(r);
      else console.log('[REMINDER] receipt pending', r.id);
    } catch (e) {
      await supabase
        .from('reminders')
        .update({
          updated_at: new Date().toISOString(),
          meta: {
            ...(r.meta || {}),
            receipt_error: e?.message || String(e),
          },
        })
        .eq('id', r.id);

      console.log('[REMINDER] receipt check error', r.id, e?.message || e);
    }
  }
}

async function processDuePending() {
  const now = new Date().toISOString();

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('due_at', now)
    .order('due_at', { ascending: true })
    .limit(50);

  if (error) throw error;

  if (!reminders?.length) {
    console.log('[REMINDER_WORKER] none due');
    return;
  }

  for (const r of reminders) {
    const { data: tokens, error: tokErr } = await supabase
      .from('push_tokens')
      .select('expo_push_token, updated_at')
      .eq('user_id', r.user_id)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (tokErr) {
      await markFailed(r, 'TOKEN_QUERY_FAIL', tokErr);
      continue;
    }

    const token = tokens?.[0]?.expo_push_token;

    if (!token) {
      await markFailed(r, 'NO_PUSH_TOKEN', null);
      continue;
    }

    const send = await sendExpoPush({
      to: token,
      title: r.title || 'Iris',
      body: r.body || '',
      data: { reminder_id: r.id, meta: r.meta || {} },
    });

    if (!send?.ok) {
      await markFailed(r, send?.error || 'SEND_FAIL', send?.details || null);
      continue;
    }

    const ticketIds = extractTicketIds(send);

    if (!ticketIds.length) {
      await markFailed(r, 'NO_TICKET_ID', send?.details || send || null);
      continue;
    }

    await markQueuedAtomic(r, ticketIds, token);
  }
}

async function run() {
  await processQueuedReceipts();
  await processDuePending();
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[REMINDER_WORKER] error', e);
    process.exit(1);
  });