// server/image/imageHandler.js
// Orchestrator: fetch Iris reference photo → generate → return result

import { generateIrisImage } from './imageGen.js';
import { extractImageIntent, looksLikeImageRequest } from './imageIntentDetector.js';

/**
 * Fetches the user's stored Iris reference photo URL from Supabase.
 * Stored in the `iris_profiles` table, column `reference_image_url`.
 * Falls back to a default if none set.
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
 * Call this when the user uploads their "Iris photo".
 */
export async function saveIrisReferencePhoto(supabase, userId, imageUrl) {
  const { error } = await supabase
    .from('iris_profiles')
    .upsert({ user_id: userId, reference_image_url: imageUrl }, { onConflict: 'user_id' });

  if (error) throw new Error('Failed to save reference photo: ' + error.message);
  return true;
}

/**
 * Main handler: checks if message is an image request, generates if so.
 *
 * @param {Object} opts
 * @param {string}  opts.message       - User message text
 * @param {string}  opts.userId
 * @param {Object}  opts.supabase
 * @param {Object}  opts.llmClient     - OpenAI-compatible client
 * @param {string}  opts.model         - LLM model string
 * @returns {Promise<{handled: boolean, imageUrl?: string, irisMessage?: string}>}
 */
export async function handleImageRequest({ message, userId, supabase, llmClient, model }) {
  // Fast keyword check first (avoid LLM call if not needed)
  if (!looksLikeImageRequest(message)) {
    return { handled: false };
  }

  console.log('[IMAGE_HANDLER] Detected potential image request');

  // LLM extracts the actual intent + what Iris should be doing
  const intent = await extractImageIntent({ text: message, llmClient, model });

  if (!intent) {
    return { handled: false };
  }

  console.log('[IMAGE_HANDLER] Intent confirmed:', intent);

  // Get reference photo
  const referenceUrl = await getIrisReferencePhoto(supabase, userId);

  if (!referenceUrl) {
    return {
      handled: true,
      imageUrl: null,
      irisMessage: 'Ešte nemám tvoju fotku! Pošli mi ju a ja sa ti sfotím kedykoľvek budeš chcieť. 📸',
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
      irisMessage: pickIrisCaption(intent.prompt),
    };
  } catch (e) {
    console.log('[IMAGE_HANDLER] Generation failed:', e?.message);
    return {
      handled: true,
      imageUrl: null,
      irisMessage: 'Ups, niečo sa pokazilo pri generovaní fotky. Skús znova? 🙈',
    };
  }
}

/**
 * Autonomous image generation (Iris sends a photo unprompted).
 * Call from reminderWorker or scheduled jobs.
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

// ─── Captions ────────────────────────────────────────────────────
function pickIrisCaption(prompt) {
  const p = (prompt || '').toLowerCase();
  if (p.includes('kitchen') || p.includes('cooking') || p.includes('dish'))
    return 'Tu som! Upratovanie riadu mi nikdy nešlo, ale aspoň vyzerám dobre. 😄';
  if (p.includes('gym') || p.includes('workout'))
    return 'Práve som dokončila tréning. Áno, som celá spotená. Nie, neľutujem. 💪';
  if (p.includes('bed') || p.includes('morning'))
    return 'Dobré ráno! Áno, takto vyzerám ráno. Nekritizuj. ☕';
  if (p.includes('café') || p.includes('coffee'))
    return 'Myslím na teba pri každej káve. 🫶';
  return 'Tu je moja fotka! 📸';
}
