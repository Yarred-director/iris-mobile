import { Router } from 'express';
import { handleImageRequest, saveIrisReferencePhoto } from '../image/imageHandler.js';
import { IMAGE_PROVIDER_OPTIONS, loadUserImageProvider, saveUserImageProvider } from '../image/imageProvider.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { parseSupabaseStorageObjectUrl } from '../media/privateMedia.js';
import { requireUserId } from '../middleware/auth.js';

const router = Router();

router.get('/iris/image-provider', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const provider = await loadUserImageProvider(req.supabase, userId);
    return res.json({ provider, options: IMAGE_PROVIDER_OPTIONS });
  } catch (error) {
    console.error('[IMAGE_PROVIDER_GET_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'image_provider_load_failed' });
  }
});

router.put('/iris/image-provider', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    if (!IMAGE_PROVIDER_OPTIONS.includes(provider)) return res.status(400).json({ error: 'invalid_image_provider' });
    const saved = await saveUserImageProvider(req.supabase, userId, provider);
    return res.json({ ok: true, provider: saved });
  } catch (error) {
    console.error('[IMAGE_PROVIDER_SAVE_ERROR]', error?.message || error);
    return res.status(error?.message === 'invalid_image_provider' ? 400 : 500).json({ error: error?.message === 'invalid_image_provider' ? 'invalid_image_provider' : 'image_provider_save_failed' });
  }
});

router.post('/iris/reference-photo', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    let bucket = String(req.body?.bucket || '');
    let path = String(req.body?.path || '');
    if ((!bucket || !path) && req.body?.imageUrl) {
      const parsed = parseSupabaseStorageObjectUrl(req.body.imageUrl);
      bucket = parsed?.bucket || '';
      path = parsed?.path || '';
    }
    if (!bucket || !path) return res.status(400).json({ error: 'bucket_and_path_required' });
    await saveIrisReferencePhoto(userId, { bucket, path });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[REFERENCE_PHOTO_ERROR]', error?.message || error);
    const invalid = error?.message === 'Invalid reference image path';
    return res.status(invalid ? 400 : 500).json({ error: invalid ? 'invalid_reference_path' : 'reference_photo_failed' });
  }
});

router.post('/iris/generate-image', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt_required' });
    const result = await handleImageRequest({
      message: prompt,
      userId,
      supabase: req.supabase,
      llmClient: getLLMClient('openai'),
      model: MODELS.openai,
    });
    return res.json({
      handled: result.handled,
      reply: result.irisMessage || '',
      image_url: result.imageUrl || null,
      image_bucket: result.imageBucket || null,
      image_path: result.imagePath || null,
      usage: result.usage || null,
    });
  } catch (error) {
    console.error('[GENERATE_IMAGE_ERROR]', error?.message || error);
    return res.status(error?.message === 'usage_limit_unavailable' ? 503 : 500).json({ error: 'image_generation_failed' });
  }
});

export default router;
