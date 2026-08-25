import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { createSignedMediaUrl, isUserOwnedMediaPath } from '../media/privateMedia.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';
import { ACTIVE_IMAGE_PROVIDER } from './imageProvider.js';

const FACE_REFERENCE_FILES = [
  { slot: 'front', name: 'face-front' },
  { slot: 'three-quarter', name: 'face-three-quarter' },
  { slot: 'side', name: 'face-side' },
];

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
        slot: 'legacy',
      };
    }
    return data.reference_image_url ? { url: data.reference_image_url, bucket: null, path: null, slot: 'legacy' } : null;
  } catch (error) {
    console.log('[REFERENCE_IMAGE] load error:', error?.message);
    return null;
  }
}

export async function getIrisReferencePhotos(supabase, userId) {
  try {
    const folder = `iris-ref/${userId}`;
    const { data, error } = await getSupabaseAdmin().storage.from('iris-photos').list(folder, { limit: 100 });
    if (!error && Array.isArray(data)) {
      const names = new Set(data.map((item) => item?.name).filter(Boolean));
      const references = [];
      for (const item of FACE_REFERENCE_FILES) {
        if (!names.has(item.name)) continue;
        const path = `${folder}/${item.name}`;
        references.push({
          url: await createSignedMediaUrl({ bucket: 'iris-photos', path, expiresIn: 900 }),
          bucket: 'iris-photos',
          path,
          slot: item.slot,
        });
      }
      if (references.length) return references;
    }
  } catch (error) {
    console.log('[REFERENCE_PACK] load error:', error?.message);
  }

  const legacy = await getIrisReferencePhoto(supabase, userId);
  return legacy ? [legacy] : [];
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
  visualState = null,
  physicalIdentity = null,
  activityState = null,
  visualPreferences = [],
}) {
  const intent = await extractImageIntent({
    text: message,
    conversationHistory,
    sceneContext,
    visualState,
    physicalIdentity,
    activityState,
    visualPreferences,
    llmClient,
    model,
  });
  if (!intent) return { handled: false };

  const references = await getIrisReferencePhotos(supabase, userId);
  if (!references.length) {
    return { handled: true, imageUrl: null, imageBucket: null, imagePath: null, irisMessage: 'Ešte nemám svoju tvár ako základ. Pridaj mi face reference pack cez menu 📸' };
  }

  const usage = await consumeDailyUsage(supabase, userId, 'image');
  if (!usage.allowed) {
    return { handled: true, imageUrl: null, imageBucket: null, imagePath: null, irisMessage: `Dnešný limit obrázkov je vyčerpaný (${usage.used}/${usage.limit}).`, usage };
  }

  const provider = ACTIVE_IMAGE_PROVIDER;
  console.log('[IMAGE_HANDLER] generation requested', {
    promptChars: String(intent.prompt || '').length,
    contextTurns: Array.isArray(conversationHistory) ? conversationHistory.length : 0,
    visualStateFields: Object.keys(visualState?.state || {}).length,
    hasPhysicalIdentity: Boolean(physicalIdentity?.body_description),
    physicalIdentitySource: physicalIdentity?.source || null,
    framing: intent.framing || null,
    referenceCount: references.length,
    referenceSlots: references.map((item) => item.slot),
    requestScope: intent.requestScope || null,
    sexualized: Boolean(intent.sexualized),
    provider,
  });

  try {
    const result = await generateIrisImage({
      prompt: intent.prompt,
      imageUrls: references.map((item) => item.url),
      provider,
      aspectRatio: intent.aspect_ratio || 'auto',
      userId,
    });
    return {
      handled: true,
      imageUrl: result.imageUrl || null,
      imageBucket: result.imageBucket || null,
      imagePath: result.imagePath || null,
      irisMessage: intent.caption || '📸',
      usage,
      provider: result.provider || provider,
      model: result.model || null,
      framing: intent.framing || null,
    };
  } catch (error) {
    console.log('[IMAGE_HANDLER] generation failed:', {
      message: error?.message,
      code: error?.code || null,
      status: error?.status || null,
      requestId: error?.requestId || null,
      moderationStage: error?.moderationStage || null,
      moderationCategories: error?.moderationCategories || [],
    });
    return {
      handled: true,
      imageUrl: null,
      imageBucket: null,
      imagePath: null,
      irisMessage: 'Ojoj, niečo sa pokazilo 🙈 Skús znova o chvíľu!',
      usage,
      errorCode: error?.code || 'image_generation_failed',
    };
  }
}

export async function generateAutonomousIrisImage({ userId, supabase, prompt, provider = ACTIVE_IMAGE_PROVIDER }) {
  const references = await getIrisReferencePhotos(supabase, userId);
  if (!references.length) return null;
  return generateIrisImage({ prompt, imageUrls: references.map((item) => item.url), provider, aspectRatio: 'auto', userId, signedUrlSeconds: 86400 });
}
