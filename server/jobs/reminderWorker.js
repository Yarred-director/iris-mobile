// server/jobs/reminderWorker.js
import { createClient } from '@supabase/supabase-js';
import '../config/env.js';
import { sendExpoPush } from '../push/expoPush.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
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
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('expo_push_token, updated_at')
      .eq('user_id', r.user_id)
      .order('updated_at', { ascending: false })
      .limit(1);

    const token = tokens?.[0]?.expo_push_token;

    if (!token) {
      await supabase
        .from('reminders')
        .update({ status: 'failed', updated_at: new Date().toISOString(), meta: { ...(r.meta || {}), send_error: 'NO_PUSH_TOKEN' } })
        .eq('id', r.id);

      console.log('[REMINDER] no token', r.id);
      continue;
    }

    const send = await sendExpoPush({
      to: token,
      title: r.title || 'Iris',
      body: r.body || '',
      data: { reminder_id: r.id, meta: r.meta || {} },
    });

    if (send.ok) {
      await supabase
        .from('reminders')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', r.id);

      console.log('[REMINDER] sent', r.id);
    } else {
      await supabase
        .from('reminders')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
          meta: { ...(r.meta || {}), send_error: send.error, send_details: send.details || null },
        })
        .eq('id', r.id);

      console.log('[REMINDER] failed', r.id, send.error, send.details || '');
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[REMINDER_WORKER] error', e);
    process.exit(1);
  });