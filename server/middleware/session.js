import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

export function sessionMiddleware(req, _res, next) {
  const authHeader = req.header('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  req.supabaseAdmin = getSupabaseAdmin();
  req.supabase = req.supabaseAdmin;
  req.reqId = req.reqId || Math.random().toString(16).slice(2, 10);

  if (!bearer) return next();

  req.supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    },
  );

  return next();
}
