// server/middleware/auth.js

export async function requireUserId(req, res) {
  if (req.authenticatedUserId) return req.authenticatedUserId;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'NO TOKEN' });
    return null;
  }

  const { data: { user }, error } = await req.supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'INVALID USER' });
    return null;
  }

  req.authenticatedUserId = user.id;
  return user.id;
}