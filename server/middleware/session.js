import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function hashString(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

// 🔐 Service client (fallback / non-auth flows)
const serviceClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export function sessionMiddleware(req, res, next) {
  // 1️⃣ Zober Authorization header (magic link session)
  const authHeader = req.header('authorization');
  const bearer = authHeader?.startsWith('Bearer ')
    ? authHeader.replace('Bearer ', '')
    : null;

  let supabase;
  let userId;

  if (bearer) {
    // ✅ USER-BOUND client (auth.uid() WILL work)
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${bearer}`
          }
        },
        auth: { persistSession: false }
      }
    );
  } else {
    // ⚠️ fallback – no user session
    supabase = serviceClient;
  }

  // 2️⃣ userId (len pre logiku / legacy)
  const headerId = req.header('x-iris-user-id');
  const bodyId = req.body?.userId;

  userId = headerId || bodyId;

  if (!userId) {
    const ua = req.header('user-agent') || '';
    const ip = req.ip || '';
    userId = `anon_${hashString(`${ip}|${ua}`)}`;
  }

  req.userId = String(userId);
  req.supabase = supabase;

  // 🔍 debug (môžeš neskôr zmazať)
  console.log(
    '🔐 SESSION →',
    bearer ? 'USER JWT' : 'SERVICE ROLE',
    '| userId =',
    req.userId
  );

  next();
}
