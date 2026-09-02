import { persistRemoteImage } from '../media/privateMedia.js';
import { ACTIVE_IMAGE_PROVIDER, resolveFalImageProvider } from './imageProvider.js';
import { fitImagePrompt, validateImagePrompt } from './imagePromptBudget.js';

const FAL_API_URL_KLING_O3 = 'https://fal.run/fal-ai/kling-image/o3/image-to-image';
const FAL_API_URL_NANO_BANANA_2 = 'https://fal.run/fal-ai/gemini-3.1-flash-image-preview/edit';
const FAL_API_URL_QWEN_IMAGE_MAX = 'https://fal.run/fal-ai/qwen-image-max/edit';
const FAL_API_URL_GROK_IMAGINE_2 = 'https://fal.run/xai/grok-imagine-image/v2.0/edit';
const FAL_API_URL_OPENAI_GPT_IMAGE_2 = 'https://fal.run/openai/gpt-image-2/edit';
const DEFAULT_IMAGE_PROVIDER = ACTIVE_IMAGE_PROVIDER;
const MAX_IDENTITY_REFERENCES = 3;

function getFalKey() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY missing in environment');
  return key;
}
function requirePrompt(prompt) {
  const value = String(prompt || '').trim();
  if (!value) throw new Error('Image prompt is empty');
  return value;
}
function normalizeAspectRatio(value) {
  const allowed = new Set(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9']);
  return allowed.has(value) ? value : 'auto';
}
function falPresetImageSize(aspectRatio) {
  return ({
    '1:1': 'square_hd',
    '3:4': 'portrait_4_3',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '16:9': 'landscape_16_9',
  })[aspectRatio] || undefined;
}
function imageTimeoutMs() {
  return Math.max(30000, Math.min(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 240000), 300000));
}
function normalizeReferenceUrls(imageUrls, imageUrl) {
  const candidates = Array.isArray(imageUrls) ? imageUrls : [];
  if (imageUrl) candidates.unshift(imageUrl);
  return [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, MAX_IDENTITY_REFERENCES);
}
function multiViewIdentityPrefix(count) {
  if (count <= 1) return count === 1
    ? 'The reference image shows Iris, the SAME clearly adult woman whose facial identity must be preserved. Use it as an identity reference, not as a body-proportion authority. '
    : '';
  return `Reference images 1-${count} show the SAME clearly adult woman, Iris, from different face angles (front, three-quarter, side when available). Use them only as identity views of one person. Preserve one consistent face; never merge, duplicate, average, or create multiple people. The reference images define facial identity, not body proportions. `;
}
function klingReferencePrefix(count) {
  if (count <= 0) return '';
  const refs = Array.from({ length: count }, (_, index) => `@Image${index + 1}`).join(' ');
  if (count === 1) return `${refs} Preserve this woman's facial identity exactly. `;
  return `${refs} These ${count} references show the SAME adult woman from different face angles. Preserve one consistent facial identity from all views; do not duplicate or blend people. `;
}
function grokReferencePrefix(count) {
  if (count <= 0) return '';
  if (count === 1) return 'Image 1 is the facial identity reference for Iris, a clearly adult woman. Create exactly one Iris and preserve her recognizable face. ';
  return `Images 1-${count} are different facial views of the SAME clearly adult woman, Iris. They are identity references, not separate people or a sequence. Create exactly one Iris; preserve one coherent recognizable face and never merge or duplicate people. `;
}
export function compactQwenMaxPrompt(prompt, referenceCount) {
  const referenceRule = referenceCount === 1
    ? 'Image 1 shows Iris, a clearly adult woman. Preserve her exact facial identity.'
    : `Images 1-${referenceCount} show the same clearly adult woman, Iris, from different face angles. Preserve one consistent face; never merge, average, duplicate, or create multiple people.`;
  return fitImagePrompt({ provider: 'qwen_image_max', prompt, prefix: referenceRule });
}
async function callFal(url, body, label, provider) {
  // Last boundary before serialization: no provider may append text after this.
  const metrics = validateImagePrompt(provider, body.prompt);
  console.log('[IMAGE_GEN_PAYLOAD]', { provider, ...metrics, referenceCount: body.image_urls.length });
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Key ${getFalKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(imageTimeoutMs()),
  });
  if (!response.ok) {
    // Don't log Fal's raw validation body: it can echo private prompts/URLs.
    const details = await response.json().catch(() => null);
    const limitIssue = Array.isArray(details?.detail) ? details.detail.find((item) =>
      /^(?:prompt: )?size must be between \d+ and \d+$/.test(item?.msg || '')) : null;
    const error = new Error(`[${label}] Fal HTTP ${response.status}`);
    error.code = `fal_http_${response.status}`;
    error.status = response.status;
    error.provider = provider;
    error.validationReason = limitIssue?.msg || null;
    error.requestId = response.headers.get('x-fal-request-id') || response.headers.get('x-request-id') || null;
    throw error;
  }
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

export async function generateIrisImage({
  prompt,
  imageUrl,
  imageUrls = [],
  provider = DEFAULT_IMAGE_PROVIDER,
  aspectRatio = 'auto',
  userId = 'shared',
  signedUrlSeconds = 86400,
}) {
  const resolvedProvider = resolveFalImageProvider(provider);
  const safeAspectRatio = normalizeAspectRatio(aspectRatio);
  const safePrompt = requirePrompt(prompt);
  const safeImageUrls = normalizeReferenceUrls(imageUrls, imageUrl);
  console.log(`[IMAGE_GEN] provider=${resolvedProvider} requested_provider=${provider} source_prompt_chars=${safePrompt.length} reference_count=${safeImageUrls.length}`);

  if (!safeImageUrls.length) throw new Error('Reference image URL missing');
  if (resolvedProvider === 'openai_gpt_image_2') return generateOpenAiGptImage2({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  if (resolvedProvider === 'grok_imagine_2') return generateGrokImagine2({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  if (resolvedProvider === 'qwen_image_max') return generateQwenImageMax({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  if (resolvedProvider === 'nano-banana-2') return generateNanoBanana2({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  return generateKlingO3({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
}

async function generateOpenAiGptImage2({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const resolvedPrompt = fitImagePrompt({ provider: 'openai_gpt_image_2', prompt, prefix: multiViewIdentityPrefix(imageUrls.length) });
  const data = await callFal(FAL_API_URL_OPENAI_GPT_IMAGE_2, {
    prompt: resolvedPrompt,
    image_urls: imageUrls,
    image_size: falPresetImageSize(aspectRatio) || 'auto',
    quality: 'high',
    num_images: 1,
    output_format: 'png',
  }, 'OPENAI_GPT_IMAGE_2', 'openai_gpt_image_2');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'openai_gpt_image_2' });
}

async function generateGrokImagine2({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const photographicProfile = 'Natural candid documentary photograph with authentic skin texture and subtle real-world imperfections, physically plausible light, exposure and lens perspective. No plastic skin, excessive smoothing, glamour retouching, artificial HDR, fake bokeh or generic AI-influencer styling.';
  const resolvedPrompt = fitImagePrompt({ provider: 'grok_imagine_2', prompt, prefix: grokReferencePrefix(imageUrls.length), suffix: photographicProfile });
  const data = await callFal(FAL_API_URL_GROK_IMAGINE_2, {
    prompt: resolvedPrompt,
    image_urls: imageUrls,
    resolution: '2k',
    quality: 'medium',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  }, 'GROK_IMAGINE_2', 'grok_imagine_2');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'grok_imagine_2' });
}

async function generateQwenImageMax({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const compactPrompt = compactQwenMaxPrompt(prompt, imageUrls.length);
  console.log(`[IMAGE_GEN_QWEN_MAX] source_prompt_chars=${prompt.length} compact_prompt_chars=${compactPrompt.length}`);
  const body = {
    prompt: fitImagePrompt({ provider: 'qwen_image_max', prompt: compactPrompt }),
    negative_prompt: 'low resolution, blurry, deformed anatomy, malformed hands, duplicate person, multiple people, inconsistent face, childlike proportions',
    image_urls: imageUrls,
    enable_prompt_expansion: true,
    // Do not add an Iris-side moderation switch. Fal may still enforce its
    // account-level checker when disabling it is not authorized for the account.
    enable_safety_checker: false,
    num_images: 1,
    output_format: 'png',
  };
  const imageSize = falPresetImageSize(aspectRatio);
  if (imageSize) body.image_size = imageSize;
  const data = await callFal(FAL_API_URL_QWEN_IMAGE_MAX, body, 'QWEN_IMAGE_MAX', 'qwen_image_max');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'qwen_image_max' });
}

async function generateNanoBanana2({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const data = await callFal(FAL_API_URL_NANO_BANANA_2, {
    prompt: fitImagePrompt({ provider: 'nano-banana-2', prompt, prefix: multiViewIdentityPrefix(imageUrls.length) }),
    image_urls: imageUrls,
    resolution: '1K',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
    limit_generations: true,
  }, 'NANO_BANANA_2', 'nano-banana-2');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'nano_banana_2' });
}

async function generateKlingO3({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const referencedPrompt = fitImagePrompt({ provider: 'kling_o3', prompt, prefix: klingReferencePrefix(imageUrls.length) });
  const data = await callFal(FAL_API_URL_KLING_O3, {
    prompt: referencedPrompt,
    image_urls: imageUrls,
    resolution: '1K',
    result_type: 'single',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  }, 'KLING_O3', 'kling_o3');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'kling_o3' });
}
