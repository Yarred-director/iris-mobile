// server/middleware/session.js
import { createClient } from '@supabase/supabase-js';

// 🔐 Service client (server-only; NEVER use for user-scoped writes where auth.uid() matters)
const serviceClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export function sessionMiddleware(req, _res, next) {
  const authHeader = req.header('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // Default: service client (for non-auth flows / internal checks)
  req.supabase = serviceClient;

  // Attach a request id for logs (optional)
  req.reqId = req.reqId || Math.random().toString(16).slice(2, 10);

  if (!bearer) {
    // IMPORTANT: do NOT emit fake userId logs (it confuses debugging)
    console.log(`SESSION [${req.reqId}] -> NO AUTH HEADER (service client)`);
    return next();
  }

  // ✅ User-bound client (auth.uid() WILL work in RPC / RLS)
  req.supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${bearer}`
        }
      }
    }
  );

  console.log(`SESSION [${req.reqId}] -> AUTH HEADER PRESENT (user client)`);
  return next();
}
