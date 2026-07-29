import { Router } from 'express';
import { createUserSignedMediaUrl } from '../media/privateMedia.js';
import { requireUserId } from '../middleware/auth.js';

const router = Router();

router.post('/media/sign', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const bucket = String(req.body?.bucket || '');
    const path = String(req.body?.path || '');
    const imageUrl = await createUserSignedMediaUrl({ bucket, path, userId, expiresIn: 3600 });
    return res.json({ image_url: imageUrl, expires_in: 3600 });
  } catch (error) {
    const forbidden = error?.message === 'Forbidden media path';
    return res.status(forbidden ? 403 : 400).json({ error: forbidden ? 'forbidden_media' : 'media_sign_failed' });
  }
});

export default router;
