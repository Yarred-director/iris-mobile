// server/image/imageHandler.js
// Orchestrator: fetch Iris reference photo → generate → return result

import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';

/**
 * Fetches the user's stored Iris reference photo URL from Supabase.
 */
export async function getIrisReferencePhoto(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_profiles')
      .select('reference_image_url')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.log('[IMAGE_HANDLER] Could not fetch reference photo:', error.message);
      return null;
    }

    return data?.reference_image_url || null;
  } catch (e) {
    console.log('[IMAGE_HANDLER] getIrisReferencePhoto error:', e?.message);
    return null;
  }
}

/**
 * Saves the user's Iris reference photo URL to Supabase.
 */
export async function saveIrisReferencePhoto(supabase, userId, imageUrl) {
  const { error } = await supabase
    .from('iris_profiles')
    .upsert({ user_id: userId, reference_image_url: imageUrl }, { onConflict: 'user_id' });

  if (error) throw new Error('Failed to save reference photo: ' + error.message);
  return true;
}

/**
 * Main handler: LLM decides if message is an image request, generates if so.
 */
export async function handleImageRequest({ message, userId, supabase, llmClient, model }) {
  // LLM decides — no keyword check, works in any language
  const intent = await extractImageIntent({ text: message, llmClient, model });

  if (!intent) {
    return { handled: false };
  }

  console.log('[IMAGE_HANDLER] Intent confirmed:', intent);

  const referenceUrl = await getIrisReferencePhoto(supabase, userId);

  if (!referenceUrl) {
    return {
      handled: true,
      imageUrl: null,
      irisMessage: "I don't have your photo yet! Send it to me and I'll take a selfie whenever you want. 📸",
    };
  }

  try {
    const result = await generateIrisImage({
      prompt: intent.prompt,
      imageUrl: referenceUrl,
      provider: intent.provider,
    });

    return {
      handled: true,
      imageUrl: result.imageUrl,
      irisMessage: null,
    };
  } catch (e) {
    console.log('[IMAGE_HANDLER] Generation failed:', e?.message);
    return {
      handled: true,
      imageUrl: null,
      irisMessage: null,
    };
  }
}

/**
 * Autonomous image generation (Iris sends a photo unprompted).
 */
export async function generateAutonomousIrisImage({ userId, supabase, prompt, provider = 'kling' }) {
  const referenceUrl = await getIrisReferencePhoto(supabase, userId);

  if (!referenceUrl) {
    console.log('[IMAGE_HANDLER] No reference photo for autonomous gen, skipping');
    return null;
  }

  try {
    const result = await generateIrisImage({ prompt, imageUrl: referenceUrl, provider });
    return { imageUrl: result.imageUrl };
  } catch (e) {
    console.log('[IMAGE_HANDLER] Autonomous gen failed:', e?.message);
    return null;
  }
}
