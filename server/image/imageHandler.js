// server/image/imageHandler.js
// Všetko cez Kling O3 — safe aj explicit

import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';

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

export async function handleImageRequest({ message, userId, supabase, llmClient, model }) {
  const intent = await extractImageIntent({ text: message, llmClient, model });
  if (!intent) return { handled: false };

  console.log('[IMAGE_HANDLER] Intent:', {
    prompt:   intent.prompt?.slice(0, 80),
    explicit: intent.explicit,
    provider: 'kling_o3',
  });

  const referenceUrl = await getIrisReferencePhoto(supabase, userId);

  if (!referenceUrl) {
    return {
      handled:     true,
      imageUrl:    null,
      irisMessage: "Ešte nemám svoju fotku ako základ. Nahraj mi ju cez menu 📸",
    };
  }

  try {
    const result = await generateIrisImage({
      prompt:   intent.prompt,
      imageUrl: referenceUrl,
      provider: 'kling',   // → Kling O3
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
