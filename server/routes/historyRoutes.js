import { Router } from 'express';
import { clearChatHistory, listChatHistory } from '../memory/chatHistory.js';
import { requireUserId } from '../middleware/auth.js';

const router = Router();

router.get('/chat/history', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const messages = await listChatHistory(req.supabase, userId, req.query?.limit);
    return res.json({ messages });
  } catch (error) {
    console.error('[CHAT_HISTORY_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'chat_history_failed' });
  }
});

router.delete('/chat/history', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    await clearChatHistory(req.supabase, userId);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[CHAT_HISTORY_CLEAR_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'chat_history_clear_failed' });
  }
});

export default router;
