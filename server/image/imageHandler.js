// server/image/imageHandler.js

import { generateIrisImage } from './imageGen.js';
import { extractImageIntent } from './imageIntentDetector.js';

function chooseProvider(intent) {
  return intent?.explicit ? 'kling' : 'openai';
}

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

  const referenceUrl = await getIrisReferencePhoto(supabase, userId);

  if (!referenceUrl) {
    return {
      handled: true,
      imageUrl: null,
      irisMessage: 'Reference photo missing.',
    };
  }

  try {
    const result = await generateIrisImage({
      prompt: intent.prompt,
      imageUrl: referenceUrl,
      provider: chooseProvider(intent),
      supabase,
      userId,
    });

    return {
      handled: true,
      imageUrl: result.imageUrl || null,
      imageBase64: result.imageBase64 || null,
      irisMessage: '📸',
    };
  } catch (e) {
    return {
      handled: true,
      imageUrl: null,
      irisMessage: 'Generation failed.',
    };
  }
}
