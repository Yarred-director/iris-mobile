import { persistRemoteImage } from '../media/privateMedia.js';
import { ACTIVE_IMAGE_PROVIDER, resolveFalImageProvider } from './imageProvider.js';

const FAL_API_URL_KLING_O3 = 'https://fal.run/fal-ai/kling-image/o3/image-to-image';
const FAL_API_URL_NANO_BANANA_2 = 'https://fal.run/fal-ai/gemini-3.1-flash-image-preview/edit';
const FAL_API_URL_QWEN_IMAGE_MAX = 'https://fal.run/fal-ai/qwen-image-max/edit';
const DEFAULT_IMAGE_PROVIDER = ACTIVE_IMAGE_PROVIDER;
const MAX_IDENTITY_REFERENCES = 3;
const QWEN_MAX_PROMPT_LIMIT = 800;

function getFalKey() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY missing in environment');
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
function extractDirective(prompt, label, terminator) {
  const start = prompt.indexOf(label);
  if (start < 0) return '';
  const valueStart = start + label.length;
  const end = prompt.indexOf(terminator, valueStart);
  return prompt.slice(valueStart, end < 0 ? undefined : end).trim().replace(/\s+/g, ' ');
}
function removeKnownBoilerplate(prompt) {
  return String(prompt || '')
    .replace(/Iris is a clearly adult woman\.[\s\S]*?minor-like body proportions\./i, ' ')
    .replace(/Natural adult female anatomy[\s\S]*?malformed limbs\./i, ' ')
    .replace(/Close-up portrait framing\. Use this only because[\s\S]*?emotional expression\./i, ' ')
    .replace(/Half-body composition from head to hips\/waist,[\s\S]*?face-only portrait\./i, ' ')
    .replace(/Three-quarter composition from head to upper thighs or knees,[\s\S]*?environment context\./i, ' ')
    .replace(/Full-body composition from head to feet with natural perspective,[\s\S]*?scene believable\./i, ' ')
    .replace(/MANDATORY USER-DEFINED BODY IDENTITY:[\s\S]*?do not reduce, enlarge, replace or reinterpret them\./i, ' ')
    .replace(/MANDATORY CURRENT VISUAL STATE:[\s\S]*?unless the current request explicitly changes them\./i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function clipField(value, max) {
  const source = String(value || '').trim().replace(/\s+/g, ' ');
  if (source.length <= max) return source;
  const clipped = source.slice(0, max);
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('; '), clipped.lastIndexOf(', '), clipped.lastIndexOf(' '));
  return clipped.slice(0, boundary > Math.floor(max * 0.65) ? boundary + 1 : max).trim();
}
function fitQwenSegments(segments, limit = QWEN_MAX_PROMPT_LIMIT) {
  let output = '';
  for (const raw of segments) {
    const segment = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!segment) continue;
    const separator = output ? ' ' : '';
    const remaining = limit - output.length - separator.length;
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      output += `${separator}${segment}`;
      continue;
    }
    const clipped = segment.slice(0, remaining);
    const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('; '), clipped.lastIndexOf(', '), clipped.lastIndexOf(' '));
    output += `${separator}${clipped.slice(0, boundary > Math.floor(remaining * 0.65) ? boundary + 1 : remaining).trim()}`;
    break;
  }
  return output.slice(0, limit).trim();
}
export function compactQwenMaxPrompt(prompt, referenceCount) {
  const source = String(prompt || '').trim();
  if (!source) throw new Error('Image prompt is empty');
  const bodyIdentity = extractDirective(source, 'MANDATORY USER-DEFINED BODY IDENTITY:', '. Preserve these body traits exactly');
  const visualState = extractDirective(source, 'MANDATORY CURRENT VISUAL STATE:', '. Preserve these exact established visible details');
  const scene = removeKnownBoilerplate(source);
  const referenceRule = referenceCount === 1
    ? 'Image 1 shows Iris, a clearly adult woman. Preserve her exact facial identity.'
    : `Images 1-${referenceCount} show the same clearly adult woman, Iris, from different face angles. Preserve one consistent face; never merge, average, duplicate, or create multiple people.`;
  return fitQwenSegments([
    referenceRule,
    'References define facial identity only. Use realistic adult anatomy and natural head-to-body scale.',
    bodyIdentity ? `Body identity: ${clipField(bodyIdentity, 150)}.` : '',
    visualState ? `Current appearance: ${clipField(visualState, 150)}.` : '',
    `Scene: ${clipField(scene, 220)}`,
    'Photorealistic personal photo, realistic skin, anatomy, lighting and perspective.',
  ]);
}
async function callFal(url, body, label) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Key ${getFalKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(imageTimeoutMs()),
  });
  if (!response.ok) throw new Error(`[${label}] ${response.status}: ${(await response.text()).slice(0, 600)}`);
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
  const safePrompt = clampPrompt(prompt, 3500);
  const safeImageUrls = normalizeReferenceUrls(imageUrls, imageUrl);
  console.log(`[IMAGE_GEN] provider=${resolvedProvider} requested_provider=${provider} prompt_chars=${String(prompt || '').length} resolved_prompt_chars=${safePrompt.length} reference_count=${safeImageUrls.length}`);

  if (!safeImageUrls.length) throw new Error('Reference image URL missing');
  if (resolvedProvider === 'qwen_image_max') return generateQwenImageMax({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  if (resolvedProvider === 'nano-banana-2') return generateNanoBanana2({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
  return generateKlingO3({ prompt: safePrompt, imageUrls: safeImageUrls, aspectRatio: safeAspectRatio, userId, signedUrlSeconds });
}

async function generateQwenImageMax({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const compactPrompt = compactQwenMaxPrompt(prompt, imageUrls.length);
  console.log(`[IMAGE_GEN_QWEN_MAX] source_prompt_chars=${prompt.length} compact_prompt_chars=${compactPrompt.length}`);
  const body = {
    prompt: compactPrompt,
    negative_prompt: 'low resolution, blurry, deformed anatomy, malformed hands, duplicate person, multiple people, inconsistent face, childlike proportions',
    image_urls: imageUrls,
    enable_prompt_expansion: true,
    enable_safety_checker: true,
    num_images: 1,
    output_format: 'png',
  };
  const imageSize = qwenImageSize(aspectRatio);
  if (imageSize) body.image_size = imageSize;
  const data = await callFal(FAL_API_URL_QWEN_IMAGE_MAX, body, 'QWEN_IMAGE_MAX');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'qwen_image_max' });
}

async function generateNanoBanana2({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const data = await callFal(FAL_API_URL_NANO_BANANA_2, {
    prompt: clampPrompt(`${multiViewIdentityPrefix(imageUrls.length)}${prompt}`),
    image_urls: imageUrls,
    resolution: '1K',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
    limit_generations: true,
  }, 'NANO_BANANA_2');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'nano_banana_2' });
}

async function generateKlingO3({ prompt, imageUrls, aspectRatio, userId, signedUrlSeconds }) {
  const referencedPrompt = clampPrompt(`${klingReferencePrefix(imageUrls.length)}${prompt}`);
  const data = await callFal(FAL_API_URL_KLING_O3, {
    prompt: referencedPrompt,
    image_urls: imageUrls,
    resolution: '1K',
    result_type: 'single',
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  }, 'KLING_O3');
  return persistFalResult(data, { userId, signedUrlSeconds, provider: 'kling_o3' });
}
