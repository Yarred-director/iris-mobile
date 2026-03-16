// server/klingGenerator.js
// Kling Image V3 - image-to-image via fal.ai
// App ID: fal-ai/kling-image/v3/image-to-image
// Docs: https://fal.ai/models/fal-ai/kling-image/v3/image-to-image
// Cena: $0.028 per image

const FAL_KEY =
  process.env.FAL_KEY ||
  process.env.FAL_API_KEY ||
  process.env.FAL_AI_KEY;

if (!FAL_KEY) {
  console.warn('[Kling] Missing FAL key (FAL_KEY / FAL_API_KEY / FAL_AI_KEY).');
}

async function falPost(appId, payload) {
  const url = `https://fal.run/${appId}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();

  if (!res.ok) {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    return { ok: false, status: res.status, error: parsed || raw };
  }

  let data;
  try { data = JSON.parse(raw); }
  catch { data = raw; }

  return { ok: true, status: res.status, data };
}

function extractImages(data) {
  // Kling image-to-image vracia { images: [{ url: '...' }] }
  if (Array.isArray(data?.images)) {
    return data.images.map((x) => x?.url).filter(Boolean);
  }
  if (data?.image?.url) return [data.image.url];
  if (data?.image_url) return [data.image_url];
  return [];
}

/**
 * Generuje obrazok pomocou Kling Image V3 image-to-image cez fal.ai
 *
 * @param {object} params
 * @param {string} params.prompt          - popis sceny / tela
 * @param {string} params.imageUrl        - referencny obrazok (tvar Iris z Supabase storage)
 * @param {number} [params.strength]      - sila i2i transformacie (0.0-1.0, default 0.85)
 * @param {string} [params.aspectRatio]   - "3:4" | "1:1" | "16:9" atd. (default "3:4")
 * @param {number} [params.numImages]     - pocet obrazkov (1-4, default 1)
 * @param {string} [params.negativePrompt]
 * @param {number} [params.seed]
 *
 * @returns {{ success: boolean, images?: string[], engine: 'kling', error?: string }}
 */
export async function generateIrisKling({
  prompt,
  imageUrl,
  strength = 0.85,
  aspectRatio = '3:4',
  numImages = 1,
  negativePrompt = '',
  seed,
}) {
  try {
    if (!prompt) {
      return { success: false, engine: 'kling', error: 'Missing prompt' };
    }
    if (!imageUrl) {
      return { success: false, engine: 'kling', error: 'Missing imageUrl (reference face)' };
    }
    if (!FAL_KEY) {
      return { success: false, engine: 'kling', error: 'Missing FAL key in env' };
    }

    const safeNumImages = Math.max(1, Math.min(4, Number(numImages) || 1));
    const safeStrength = Math.max(0.0, Math.min(1.0, Number(strength) || 0.85));

    const payload = {
      prompt,
      image_url: imageUrl,
      strength: safeStrength,
      aspect_ratio: aspectRatio,
      num_images: safeNumImages,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(seed != null ? { seed: Number(seed) } : { seed: Math.floor(Math.random() * 2147483647) }),
    };

    console.log('[Kling] Calling fal-ai/kling-image/v3/image-to-image', {
      aspectRatio,
      strength: safeStrength,
      numImages: safeNumImages,
    });

    const out = await falPost('fal-ai/kling-image/v3/image-to-image', payload);

    if (!out.ok) {
      return {
        success: false,
        engine: 'kling',
        error: `fal.ai Kling error ${out.status}`,
        details: out.error,
      };
    }

    const images = extractImages(out.data);
    if (!images.length) {
      return { success: false, engine: 'kling', error: 'No images returned', raw: out.data };
    }

    return { success: true, engine: 'kling', images };

  } catch (e) {
    return {
      success: false,
      engine: 'kling',
      error: e?.message || 'Kling generation failed',
    };
  }
}
