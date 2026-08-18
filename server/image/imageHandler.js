import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { createSignedMediaUrl, isUserOwnedMediaPath } from '../media/privateMedia.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';

export async function getIrisReferencePhoto(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_profiles')
      .select('reference_image_bucket, reference_image_path, reference_image_url')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    if (data.reference_image_bucket && data.reference_image_path) {
      return {
        url: await createSignedMediaUrl({ bucket: data.reference_image_bucket, path: data.reference_image_path, expiresIn: 900 }),
        bucket: data.reference_image_bucket,
        path: data.reference_image_path,
      };
    }
    return data.reference_image_url ? { url: data.reference_image_url, bucket: null, path: null } : null;
  } catch (error) {
    console.log('[REFERENCE_IMAGE] load error:', error?.message);
    return null;
  }
}

export async function saveIrisReferencePhoto(userId, { bucket, path }) {
  if (!isUserOwnedMediaPath(bucket, path, userId) || !String(path).startsWith(`iris-ref/${userId}/`)) {
    throw new Error('Invalid reference image path');
  }
  const { error } = await getSupabaseAdmin().from('iris_profiles').upsert({
    user_id: userId,
    reference_image_bucket: bucket,
    reference_image_path: path,
    reference_image_url: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return true;
}

export async function handleImageRequest({
  message,
  userId,
  supabase,
  llmClient,
  model,
  conversationHistory = [],
  sceneContext = null,
}) {
  const intent = await extractImageIntent({
    text: message,
    conversationHistory,
    sceneContext,
    llmClient,
    model,
  });
  if (!intent) return { handled: false };

  const reference = await getIrisReferencePhoto(supabase, userId);
  if (!reference?.url) {
    return { handled: true, imageUrl: null, imageBucket: null, imagePath: null, irisMessage: 'Ešte nemám svoju fotku ako základ. Nahraj mi ju cez menu 📸' };
  }

  const usage = await consumeDailyUsage(supabase, userId, 'image');
  if (!usage.allowed) {
    return { handled: true, imageUrl: null, imageBucket: null, imagePath: null, irisMessage: `Dnešný limit obrázkov je vyčerpaný (${usage.used}/${usage.limit}).`, usage };
  }

  console.log('[IMAGE_HANDLER] generation requested', {
    promptChars: String(intent.prompt || '').length,
    contextTurns: Array.isArray(conversationHistory) ? conversationHistory.length : 0,
    provider: 'kling_o3',
  });

  try {
    const result = await generateIrisImage({
      prompt: intent.prompt,
      imageUrl: reference.url,
      provider: 'kling',
      aspectRatio: intent.aspect_ratio || 'auto',
      userId,
    });
    return {
      handled: true,
      imageUrl: result.imageUrl || null,
      imageBucket: result.imageBucket || null,
      imagePath: result.imagePath || null,
      irisMessage: '📸',
      usage,
    };
  } catch (error) {
    console.log('[IMAGE_HANDLER] generation failed:', error?.message);
    return {
      handled: true,
      imageUrl: null,
      imageBucket: null,
      imagePath: null,
      irisMessage: 'Ojoj, niečo sa pokazilo 🙈 Skús znova o chvíľu!',
      usage,
    };
  }
}

export async function generateAutonomousIrisImage({ userId, supabase, prompt, provider = 'kling' }) {
  const reference = await getIrisReferencePhoto(supabase, userId);
  if (!reference?.url) return null;
  return generateIrisImage({ prompt, imageUrl: reference.url, provider, aspectRatio: 'auto', userId, signedUrlSeconds: 86400 });
}
