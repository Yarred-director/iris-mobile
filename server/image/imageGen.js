// server/image/imageGen.js

const FAL_API_URL_FLUX  = 'https://fal.run/fal-ai/flux/dev/image-to-image';
const FAL_API_URL_KLING = 'https://fal.run/fal-ai/kling-image/v3/image-to-image';
const FAL_API_URL_XAI   = 'https://fal.run/xai/grok-imagine-image/edit';
const OPENAI_IMAGE_URL  = 'https://api.openai.com/v1/images/generations';

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

// ─── Supabase persistence ─────────────────────────────────────────
async function persistToSupabase(imageUrl, supabase, userId) {
  if (!supabase || !imageUrl) return imageUrl;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const filePath = `generated/${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('iris-photos')
      .upload(filePath, new Uint8Array(buffer), { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('iris-photos').getPublicUrl(filePath);
    return data.publicUrl || imageUrl;
  } catch (e) {
    console.log('[IMAGE_GEN] Persist failed, using original URL:', e?.message);
    return imageUrl;
  }
}

async function persistBase64ToSupabase(base64, supabase, userId) {
  if (!supabase || !base64) return null;
  try {
    const bytes    = Buffer.from(base64, 'base64');
    const filePath = `generated/${userId}/${Date.now()}.png`;
    const { error } = await supabase.storage
      .from('iris-photos')
      .upload(filePath, bytes, { contentType: 'image/png', upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('iris-photos').getPublicUrl(filePath);
    return data.publicUrl || null;
  } catch (e) {
    console.log('[IMAGE_GEN] Base64 persist failed:', e?.message);
    return null;
  }
}

// ─── Main entry ───────────────────────────────────────────────────
export async function generateIrisImage({
  prompt,
  imageUrl,
  provider = 'flux',
  strength = 0.82,
  aspectRatio = '1:1',
  supabase = null,
  userId = 'shared',
}) {
  console.log(`[IMAGE_GEN] provider=${provider} prompt="${prompt.slice(0, 80)}"`);

  if (provider === 'openai') {
    return generateOpenAI({ prompt, supabase, userId });
  }
  if (provider === 'flux') {
    return generateFlux({ prompt, imageUrl, strength, supabase, userId });
  }
  if (provider === 'xai') {
    return generateXAI({ prompt, imageUrl, strength, supabase, userId });
  }
  // fallback
  return generateKling({ prompt, imageUrl, strength, aspectRatio, supabase, userId });
}

// ─── Flux Dev img2img + Realism LoRA ─────────────────────────────
async function generateFlux({ prompt, imageUrl, strength, supabase, userId }) {
  const falKey = getFalKey();

  const body = {
    prompt,
    image_url: imageUrl,
    strength,
    loras: [
      {
        path: 'XLabs-AI/flux-RealismLora',
        scale: 1.0,
      },
    ],
    num_inference_steps: 28,
    guidance_scale: 3.5,
    enable_safety_checker: false,
    safety_tolerance: '5',
    output_format: 'jpeg',
  };

  console.log('[IMAGE_GEN][FLUX] Sending request', { prompt: prompt.slice(0, 80), strength });

  const res = await fetch(FAL_API_URL_FLUX, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[FLUX] fal.ai error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log('[IMAGE_GEN][FLUX] Done', { url: (data?.images?.[0]?.url || '').slice(0, 60) });

  const rawUrl = data?.images?.[0]?.url || data?.image?.url;
  if (!rawUrl) throw new Error('[FLUX] No image URL in response');

  const permanentUrl = await persistToSupabase(rawUrl, supabase, userId);
  return { imageUrl: permanentUrl, provider: 'flux' };
}

// ─── OpenAI gpt-image-1 ───────────────────────────────────────────
async function generateOpenAI({ prompt, supabase, userId }) {
  const apiKey = getOpenAIKey();

  const res = await fetch(OPENAI_IMAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1536',
      quality: 'high',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[OPENAI] error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('[OPENAI] No image returned');

  const imageUrl = await persistBase64ToSupabase(base64, supabase, userId);
  return { imageUrl, provider: 'openai' };
}

// ─── Kling v3 img2img ─────────────────────────────────────────────
async function generateKling({ prompt, imageUrl, strength, aspectRatio, supabase, userId }) {
  const falKey = getFalKey();

  console.log('[IMAGE_GEN][KLING] Sending request', { prompt: prompt.slice(0, 80) });

  const res = await fetch(FAL_API_URL_KLING, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_url: imageUrl, strength, aspect_ratio: aspectRatio }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[KLING] error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  const rawUrl = data?.images?.[0]?.url || data?.image?.url;
  if (!rawUrl) throw new Error('[KLING] No image URL');

  console.log('[IMAGE_GEN][KLING] Done', { url: rawUrl.slice(0, 60) });
  const permanentUrl = await persistToSupabase(rawUrl, supabase, userId);
  return { imageUrl: permanentUrl, provider: 'kling' };
}

// ─── XAI Grok ────────────────────────────────────────────────────
async function generateXAI({ prompt, imageUrl, strength, supabase, userId }) {
  const falKey = getFalKey();

  console.log('[IMAGE_GEN][XAI] Sending request', { prompt: prompt.slice(0, 80) });

  const res = await fetch(FAL_API_URL_XAI, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_url: imageUrl, strength }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[XAI] error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  const rawUrl = data?.images?.[0]?.url || data?.image?.url;
  if (!rawUrl) throw new Error('[XAI] No image URL');

  console.log('[IMAGE_GEN][XAI] Done', { url: rawUrl.slice(0, 60) });
  const permanentUrl = await persistToSupabase(rawUrl, supabase, userId);
  return { imageUrl: permanentUrl, provider: 'xai' };
}
