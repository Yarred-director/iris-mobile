import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireUserId } from '../middleware/auth.js';

const router = Router();
const ALLOWED_PLATFORMS = new Set(['android', 'ios', 'web', 'unknown']);

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
