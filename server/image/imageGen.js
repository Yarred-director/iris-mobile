// server/image/imageGen.js
// Iris image generation — fal.ai providers
// Providers:
//   'kling'  → kling-image/v3/image-to-image   (safe/artistic)
//   'xai'    → xai/grok-imagine-image/edit      (nudity-friendly)

const FAL_API_URL_KLING = 'https://fal.run/kling-image/v3/image-to-image';
const FAL_API_URL_XAI   = 'https://fal.run/xai/grok-imagine-image/edit';

function getFalKey() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY missing in environment');
  return key;
}

/**
 * Generates an image with Iris using a reference photo (user's Iris photo).
 *
 * @param {Object} opts
 * @param {string}  opts.prompt          - What Iris should be doing in the image
 * @param {string}  opts.imageUrl        - Public URL of the reference (Iris) image
 * @param {'kling'|'xai'} opts.provider  - Which fal.ai provider to use
 * @param {number}  [opts.strength]      - Denoising strength 0–1 (default 0.75)
 * @param {string}  [opts.aspectRatio]   - e.g. '1:1', '9:16', '16:9' (default '1:1')
 * @returns {Promise<{imageUrl: string, seed?: number}>}
 */
export async function generateIrisImage({
  prompt,
  imageUrl,
  provider = 'kling',
  strength = 0.75,
  aspectRatio = '1:1',
}) {
  const falKey = getFalKey();

  if (provider === 'xai') {
    return generateXAI({ prompt, imageUrl, strength, falKey });
  }

  return generateKling({ prompt, imageUrl, strength, aspectRatio, falKey });
}

// ─────────────────────────────────────────────────────────────────
// KLING v3 image-to-image
// ─────────────────────────────────────────────────────────────────
async function generateKling({ prompt, imageUrl, strength, aspectRatio, falKey }) {
  const body = {
    prompt,
    image_url: imageUrl,
    strength,
    aspect_ratio: aspectRatio,
  };

  console.log('[IMAGE_GEN][KLING] Sending request', { prompt: prompt.slice(0, 80) });

  const res = await fetch(FAL_API_URL_KLING, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[KLING] fal.ai error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  console.log('[IMAGE_GEN][KLING] Done', { url: data?.images?.[0]?.url?.slice(0, 60) });

  const resultUrl = data?.images?.[0]?.url || data?.image?.url;
  if (!resultUrl) throw new Error('[KLING] No image URL in response');

  return { imageUrl: resultUrl, seed: data?.seed };
}

// ─────────────────────────────────────────────────────────────────
// xAI Grok Imagine image/edit
// ─────────────────────────────────────────────────────────────────
async function generateXAI({ prompt, imageUrl, strength, falKey }) {
  const body = {
    prompt,
    image_url: imageUrl,
    strength,
  };

  console.log('[IMAGE_GEN][XAI] Sending request', { prompt: prompt.slice(0, 80) });

  const res = await fetch(FAL_API_URL_XAI, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[XAI] fal.ai error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  console.log('[IMAGE_GEN][XAI] Done', { url: data?.images?.[0]?.url?.slice(0, 60) });

  const resultUrl = data?.images?.[0]?.url || data?.image?.url;
  if (!resultUrl) throw new Error('[XAI] No image URL in response');

  return { imageUrl: resultUrl, seed: data?.seed };
}
