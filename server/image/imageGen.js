import { persistBase64Image, persistRemoteImage } from '../media/privateMedia.js';

const FAL_API_URL_KLING_O3 = 'https://fal.run/fal-ai/kling-image/o3/image-to-image';
const FAL_API_URL_QWEN_IMAGE_2 = 'https://fal.run/fal-ai/qwen-image-2/edit';
const FAL_API_URL_NANO_BANANA_2 = 'https://fal.run/fal-ai/gemini-3.1-flash-image-preview/edit';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_IMAGE_PROVIDER = process.env.IRIS_IMAGE_PROVIDER || 'qwen2';

function getFalKey() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY missing in environment');
  return key;
}
function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}
function clampPrompt(prompt, max = 2500) {
  const value = String(prompt || '').trim();
  if (!value) throw new Error('Image prompt is empty');
  return value.slice(0, max);
}
function normalizeAspectRatio(value) {
  const allowed = new Set(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9']);
  return allowed.has(value) ? value : 'auto';
}
function qwenImageSize(aspectRatio) {
  const map = {
    '1:1': 'square_hd',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3',
  };
  return map[aspectRatio] || null;
}
function imageTimeoutMs() {
  return Math.max(30000, Math.min(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 240000), 300000));
}
async function callFal(url, body, label) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Key ${getFalKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(imageTimeoutMs()),
  });
  if (!response.ok) throw new Error(`[${label}] ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
async function persistFalResult(data, { userId, signedUrlSeconds, provider }) {
  const image = data?.images?.[0] || data?.image || null;
  if (!image?.url) throw new Error(`[${provider}] No image URL in response`);
  const persisted = await persistRemoteImage({
    sourceUrl: image.url,
    userId,
    contentType: image.content_type || 'image/png',
    signedUrlSeconds,
  });
  return { ...persisted, provider };
}

export async function generateIrisImage({ prompt, imageUrl, provider = DEFAULT_IMAGE_PROVIDER, aspectRatio = 'auto', userId = 'shared', signedUrlSeconds = 86400 }) {
  const safeAspectRatio = normalizeAspectRatio(aspectRatio);
  const safePrompt = clampPrompt(prompt, provider === 'qwen2' ? 800 : 2500);
  console.log(`[IMAGE_GEN] provider=${provider} prompt_chars=${String(prompt || '').length}`);

  if (provider === 'openai') return generateOpenAI({ prompt: safePrompt, userId, signedUrlSeconds });
  if (provider === 'nano-banana-2') return generateNanoBanana2({ prompt: safePrompt, imageUrl, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  if (provider === 'kling' || provider === 'kling_o3') return generateKlingO3({ prompt: safePrompt, imageUrl, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });

  try {
    return await generateQwenImage2({ prompt: safePrompt, imageUrl, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  } catch (qwenError) {
    console.log('[IMAGE_GEN] Qwen Image 2 failed, falling back to Kling O3:', qwenError?.message);
    try {
      return await generateKlingO3({ prompt: clampPrompt(prompt), imageUrl, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
    } catch (klingError) {
      throw new Error(`Qwen failed: ${qwenError?.message}; Kling fallback failed: ${klingError?.message}`);
    }
  }
}

async function generateQwenImage2({ prompt, imageUrl, aspectRatio, userId, signedUrlSeconds }) {
  if (!imageUrl) throw new Error('Reference image URL missing');
  const body = {
    prompt,
    image_urls: [imageUrl],
    enable_prompt_expansion: true,
    enable_safety_checker: true,
    num_images: 1,
    output_format: 'png',
  };
  const imageSize = qwenImageSize(aspectRatio);
  if (imageSize) body.image_size = imageSize;
  const data = await callFal(FAL_API_URL_QWEN_IMAGE_2, body, 'QWEN_IMAGE_2');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'qwen_image_2' });
}

async function generateNanoBanana2({ prompt, imageUrl, aspectRatio, userId, signedUrlSeconds }) {
  if (!imageUrl) throw new Error('Reference image URL missing');
  const data = await callFal(FAL_API_URL_NANO_BANANA_2, {
    prompt,
    image_urls: [imageUrl],
    resolution: '1K',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
    limit_generations: true,
  }, 'NANO_BANANA_2');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'nano_banana_2' });
}

async function generateKlingO3({ prompt, imageUrl, aspectRatio, userId, signedUrlSeconds }) {
  if (!imageUrl) throw new Error('Reference image URL missing');
  const referencedPrompt = /@Image\d*/i.test(prompt) ? prompt : `@Image1 ${prompt}`;
  const data = await callFal(FAL_API_URL_KLING_O3, {
    prompt: referencedPrompt,
    image_urls: [imageUrl],
    resolution: '1K',
    result_type: 'single',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  }, 'KLING_O3');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'kling_o3' });
}

async function generateOpenAI({ prompt, userId, signedUrlSeconds }) {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getOpenAIKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1536', quality: 'high', output_format: 'png' }),
    signal: AbortSignal.timeout(imageTimeoutMs()),
  });
  if (!response.ok) throw new Error(`[OPENAI_IMAGE] ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('[OPENAI_IMAGE] No image returned');
  const persisted = await persistBase64Image({ base64, userId, contentType: 'image/png', signedUrlSeconds });
  return { ...persisted, provider: 'openai' };
}
