import crypto from 'crypto';

function hashString(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

export function sessionMiddleware(req, res, next) {
  // Prefer explicit user id from client (mobile app)
  const headerId = req.header('x-iris-user-id');
  const bodyId = req.body?.userId;

  let userId = headerId || bodyId;

  // Fallback (last resort): derive a stable-ish id
  // (not perfect, but better than hardcoding)
  if (!userId) {
    const ua = req.header('user-agent') || '';
    const ip = req.ip || '';
    userId = `anon_${hashString(`${ip}|${ua}`)}`;
  }

  req.userId = String(userId);
  next();
}
