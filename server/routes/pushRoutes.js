import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getWebPushPublicKey } from '../lib/webPush.js';
import { requireUserId } from '../middleware/auth.js';

const router = Router();
const ALLOWED_PLATFORMS = new Set(['android', 'ios', 'web', 'unknown']);

router.get('/push/web/public-key', (_req, res) => {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) return res.status(503).json({ error: 'web_push_not_configured' });
  return res.json({ public_key: publicKey });
});

router.post('/push/web/register', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const endpoint = String(req.body?.subscription?.endpoint || '').trim();
    const p256dh = String(req.body?.subscription?.keys?.p256dh || '').trim() || null;
    const auth = String(req.body?.subscription?.keys?.auth || '').trim() || null;
    if (!endpoint.startsWith('https://') || endpoint.length > 3000) {
      return res.status(400).json({ error: 'invalid_web_push_endpoint' });
    }

    const now = new Date().toISOString();
    const { error } = await getSupabaseAdmin().from('web_push_subscriptions').upsert({
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: String(req.header('user-agent') || '').slice(0, 500) || null,
      disabled_at: null,
      last_seen_at: now,
      updated_at: now,
    }, { onConflict: 'endpoint' });
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[WEB_PUSH_REGISTER_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'web_push_register_failed' });
  }
});

router.delete('/push/web/register', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) return res.status(400).json({ error: 'web_push_endpoint_required' });
    const { error } = await getSupabaseAdmin().from('web_push_subscriptions')
      .delete().eq('user_id', userId).eq('endpoint', endpoint);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[WEB_PUSH_UNREGISTER_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'web_push_unregister_failed' });
  }
});

router.post('/push/register', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const expoPushToken = String(req.body?.expo_push_token || '').trim();
    const platformRaw = String(req.body?.platform || 'unknown').toLowerCase();
    const platform = ALLOWED_PLATFORMS.has(platformRaw) ? platformRaw : 'unknown';
    const deviceId = req.body?.device_id ? String(req.body.device_id).slice(0, 200) : null;
    if (!Expo.isExpoPushToken(expoPushToken)) return res.status(400).json({ error: 'invalid_expo_push_token' });

    const now = new Date().toISOString();
    const { error } = await getSupabaseAdmin().from('push_tokens').upsert({
      user_id: userId,
      expo_push_token: expoPushToken,
      platform,
      device_id: deviceId,
      disabled_at: null,
      last_seen_at: now,
      updated_at: now,
    }, { onConflict: 'expo_push_token' });
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[PUSH_REGISTER_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'push_register_failed' });
  }
});

router.delete('/push/register', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const expoPushToken = String(req.body?.expo_push_token || '').trim();
    if (!expoPushToken) return res.status(400).json({ error: 'expo_push_token_required' });
    const { error } = await getSupabaseAdmin().from('push_tokens')
      .delete().eq('user_id', userId).eq('expo_push_token', expoPushToken);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[PUSH_UNREGISTER_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'push_unregister_failed' });
  }
});

export default router;
