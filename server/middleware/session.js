import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function hashString(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export function sessionMiddleware(req, res, next) {
  const headerId = req.header('x-iris-user-id');
  const bodyId = req.body?.userId;

  let userId = headerId || bodyId;

  if (!userId) {
    const ua = req.header('user-agent') || '';
    const ip = req.ip || '';
    userId = `anon_${hashString(`${ip}|${ua}`)}`;
  }

  req.userId = String(userId);
  req.supabase = supabase;

  next();
}
