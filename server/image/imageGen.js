import { persistBase64Image, persistRemoteImage } from '../media/privateMedia.js';

const FAL_API_URL_KLING_O3 = 'https://fal.run/fal-ai/kling-image/o3/image-to-image';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';

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
function clampPrompt(prompt) {
  const value = String(prompt || '').trim();
  if (!value) throw new Error('Image prompt is empty');
  return value.slice(0, 2500);
}
function normalizeAspectRatio(value) {
  const allowed = new Set(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9']);
  return allowed.has(value) ? value : 'auto';
}

export async function generateIrisImage({ prompt, imageUrl, provider = 'kling', aspectRatio = 'auto', userId = 'shared', signedUrlSeconds = 86400 }) {
  const safePrompt = clampPrompt(prompt);
  console.log(`[IMAGE_GEN] provider=${provider} prompt_chars=${safePrompt.length}`);
  if (provider === 'openai') return generateOpenAI({ prompt: safePrompt, userId, signedUrlSeconds });
  return generateKlingO3({ prompt: safePrompt, imageUrl, aspectRatio: normalizeAspectRatio(aspectRatio), userId, signedUrlSeconds });
}

async function generateKlingO3({ prompt, imageUrl, aspectRatio, userId, signedUrlSeconds }) {
  if (!imageUrl) throw new Error('Reference image URL missing');
  const referencedPrompt = /@Image\d*/i.test(prompt) ? prompt : `@Image1 ${prompt}`;
  const body = {
    prompt: referencedPrompt,
    image_urls: [imageUrl],
    resolution: '1K',
    result_type: 'single',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  };
  const timeoutMs = Math.max(30000, Math.min(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 240000), 300000));
  const response = await fetch(FAL_API_URL_KLING_O3, {
    method: 'POST',
    headers: { Authorization: `Key ${getFalKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`[KLING_O3] ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const image = data?.images?.[0] || data?.image || null;
  if (!image?.url) throw new Error('[KLING_O3] No image URL in response');
  const persisted = await persistRemoteImage({
    sourceUrl: image.url,
    userId,
    contentType: image.content_type || 'image/png',
    signedUrlSeconds,
  });
  return { ...persisted, provider: 'kling_o3' };
}

async function generateOpenAI({ prompt, userId, signedUrlSeconds }) {
  const timeoutMs = Math.max(30000, Math.min(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 240000), 300000));
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getOpenAIKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1536', quality: 'high', output_format: 'png' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`[OPENAI_IMAGE] ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('[OPENAI_IMAGE] No image returned');
  const persisted = await persistBase64Image({ base64, userId, contentType: 'image/png', signedUrlSeconds });
  return { ...persisted, provider: 'openai' };
}
