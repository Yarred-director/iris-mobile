// server/image/imageHandler.js

import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';

// ─── Provider routing ─────────────────────────────────────────────
// explicit/NSFW  → Flux dev + Realism LoRA (img2img, safety off)
// safe selfie    → OpenAI gpt-image-1 (no reference needed, clean output)
function chooseProvider(intent) {
  if (intent?.explicit) return 'flux';
  return 'openai';
}

// ─── Reference photo ─────────────────────────────────────────────
export async function getIrisReferencePhoto(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_profiles')
      .select('reference_image_url')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data?.reference_image_url || null;
  } catch {
    return null;
  }
}

export async function saveIrisReferencePhoto(supabase, userId, imageUrl) {
  const { error } = await supabase
    .from('iris_profiles')
    .upsert({ user_id: userId, reference_image_url: imageUrl }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return true;
}

// ─── Main handler ─────────────────────────────────────────────────
export async function handleImageRequest({ message, userId, supabase, llmClient, model }) {
  const intent = await extractImageIntent({ text: message, llmClient, model });
  if (!intent) return { handled: false };

  console.log('[IMAGE_HANDLER] Intent:', {
    prompt: intent.prompt?.slice(0, 80),
    explicit: intent.explicit,
    provider: chooseProvider(intent),
  });

  const provider     = chooseProvider(intent);
  const referenceUrl = await getIrisReferencePhoto(supabase, userId);

  // Flux vyžaduje referenčnú fotku — bez nej fallback na OpenAI
  if (provider === 'flux' && !referenceUrl) {
    console.log('[IMAGE_HANDLER] No reference photo, falling back to openai');
  }

  if (!referenceUrl && provider !== 'openai') {
    return {
      handled: true,
      imageUrl: null,
      irisMessage: "Ešte nemám svoju fotku ako základ. Nahraj mi ju cez menu 📸",
    };
  }

  try {
    const result = await generateIrisImage({
      prompt:     intent.prompt,
      imageUrl:   referenceUrl,
      provider,
      supabase,
      userId,
    });

    return {
      handled:     true,
      imageUrl:    result.imageUrl || null,
      irisMessage: '📸',
    };
  } catch (e) {
    console.log('[IMAGE_HANDLER] Generation failed:', e?.message);
    return {
      handled:     true,
      imageUrl:    null,
      irisMessage: 'Ojoj, niečo sa pokazilo 🙈 Skús znova o chvíľu!',
    };
  }
}
