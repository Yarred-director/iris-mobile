import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { createSignedMediaUrl, isUserOwnedMediaPath } from '../media/privateMedia.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';
import { loadUserImageProvider } from './imageProvider.js';
import { persistVisualSignals } from '../memory/visualState.js';
import { localizedLine } from '../i18n/localize.js';

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
  language = null,
}) {
  // Select once, before composing any provider-facing identity text. Immediate
  // and scheduled requests share this same authoritative persisted selection.
  const provider = await loadUserImageProvider(getSupabaseAdmin(), userId);
  const intent = await extractImageIntent({
    text: message,
    conversationHistory,
    sceneContext,
    visualState,
    physicalIdentity,
    activityState,
    visualPreferences,
    provider,
    llmClient,
    model,
  });
  if (!intent) return { handled: false };

  if (intent.outfitOverride) {
    await persistVisualSignals({
      supabase,
      userId,
      intent: {
        visual_change: 'explicit',
        appearance_patch: { outfit: intent.outfitOverride },
        clear_appearance_fields: intent.resetsSceneDetails ? ['other_details'] : [],
        appearance_confidence: 0.99,
        image_delivery_mode: 'immediate',
        visual_preference_updates: [],
      },
      currentVisualState: visualState,
    });
  }

  const references = await getIrisReferencePhotos(supabase, userId);
  if (!references.length) {
    return { handled: true, imageUrl: null, imageBucket: null, imagePath: null, irisMessage: await localizedLine('image_face_missing', language) };
  }

  const usage = await consumeDailyUsage(supabase, userId, 'image');
  if (!usage.allowed) {
    return { handled: true, imageUrl: null, imageBucket: null, imagePath: null, irisMessage: await localizedLine('image_daily_limit_reached', language, { used: usage.used, limit: usage.limit }), usage };
  }

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
    imageDiagnostics: intent.imageDiagnostics || null,
    provider,
  });

  const generate = (prompt, aspectRatio) => generateIrisImage({
    prompt,
    imageUrls: references.map((item) => item.url),
    provider,
    aspectRatio: aspectRatio || 'auto',
    userId,
  });

  try {
    let result;
    try {
      try {
        result = await generate(intent.prompt, intent.aspect_ratio);
      } catch (error) {
        // Output-stage moderation is non-deterministic: the same prompt is worth one more attempt.
        if (error?.moderationStage !== 'provider_upstream_rejection') throw error;
        console.log('[IMAGE_HANDLER] upstream rejection, repeating once', { provider, requestId: error.requestId || null });
        result = await generate(intent.prompt, intent.aspect_ratio);
      }
    } catch (error) {
      if (!error?.moderationStage) throw error;
      // One conservative recomposition of the same shot after a content-checker rejection: no body
      // description and a non-sexualized, fully dressed outfit. The face references keep her identity.
      console.log('[IMAGE_HANDLER] moderation rejection, retrying conservatively', { provider, moderationStage: error.moderationStage, requestId: error.requestId || null });
      const conservative = await extractImageIntent({
        text: message,
        conversationHistory,
        sceneContext,
        visualState,
        physicalIdentity: null,
        activityState,
        visualPreferences,
        provider,
        llmClient,
        model,
        forceNonSexual: true,
      });
      if (!conservative) throw error;
      result = await generate(conservative.prompt, conservative.aspect_ratio);
    }
    console.log('[IMAGE_HANDLER] generation succeeded', { provider: result.provider, referenceCount: references.length, persisted: Boolean(result.imagePath) });
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
      provider: error?.provider || provider,
      validationReason: error?.validationReason || null,
      moderationStage: error?.moderationStage || null,
      moderationCategories: error?.moderationCategories || [],
    });
    return {
      handled: true,
      imageUrl: null,
      imageBucket: null,
      imagePath: null,
      irisMessage: await localizedLine('image_generation_failed', language),
      usage,
      errorCode: error?.code || 'image_generation_failed',
    };
  }
}

export async function generateAutonomousIrisImage({ userId, supabase, prompt, provider = null }) {
  const references = await getIrisReferencePhotos(supabase, userId);
  if (!references.length) return null;
  const resolvedProvider = provider || await loadUserImageProvider(supabase, userId);
  return generateIrisImage({ prompt, imageUrls: references.map((item) => item.url), provider: resolvedProvider, aspectRatio: 'auto', userId, signedUrlSeconds: 86400 });
}
