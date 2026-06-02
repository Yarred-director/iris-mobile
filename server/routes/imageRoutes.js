// server/routes/imageRoutes.js

import { Router } from 'express';
import { requireUserId } from '../middleware/auth.js';
import { handleImageRequest, saveIrisReferencePhoto } from '../image/imageHandler.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const router = Router();

// POST /iris/reference-photo
router.post('/iris/reference-photo', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    await saveIrisReferencePhoto(req.supabase, userId, imageUrl);
    console.log('[REF_PHOTO] Saved for user', userId);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[REF_PHOTO ERROR]', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /iris/generate-image
router.post('/iris/generate-image', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { prompt, provider = 'kling' } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const imageResult = await handleImageRequest({
      message: prompt,
      userId,
      supabase: req.supabase,
      llmClient: getLLMClient('openai'),
      model: MODELS.openai,
    });

    return res.json(imageResult);
  } catch (e) {
    console.error('[GENERATE_IMAGE ERROR]', e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;