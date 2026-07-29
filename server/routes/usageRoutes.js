import { Router } from 'express';
import { requireUserId } from '../middleware/auth.js';
import { getEffectiveDailyLimit } from '../middleware/usageLimit.js';

const router = Router();

router.get('/me/usage', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const today = new Date().toISOString().slice(0, 10);
    const [{ data, error }, chatEntitlement, imageEntitlement] = await Promise.all([
      req.supabase.from('api_usage_daily')
        .select('usage_date, chat_count, image_count, updated_at')
        .eq('user_id', userId).eq('usage_date', today).maybeSingle(),
      getEffectiveDailyLimit(req.supabase, userId, 'chat'),
      getEffectiveDailyLimit(req.supabase, userId, 'image'),
    ]);
    if (error) throw new Error(error.message);
    const reset = new Date();
    reset.setUTCDate(reset.getUTCDate() + 1);
    reset.setUTCHours(0, 0, 0, 0);
    return res.json({
      usage_date: today,
      tier: chatEntitlement.tier,
      chat: { used: Number(data?.chat_count || 0), limit: chatEntitlement.limit },
      image: { used: Number(data?.image_count || 0), limit: imageEntitlement.limit },
      resets_at: reset.toISOString(),
    });
  } catch (error) {
    console.error('[USAGE_STATUS_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'usage_status_failed' });
  }
});

export default router;
