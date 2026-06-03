// server/image/imageGen.js
// Primary: Kling Omni 3 (o3) — najnovší, najlepšia konzistencia tváre

// Kling Omni 3 — nový endpoint, image_urls je pole
const FAL_API_URL_KLING_O3 = 'https://fal.run/fal-ai/kling-image/o3/image-to-image';
const OPENAI_IMAGE_URL      = 'https://api.openai.com/v1/images/generations';

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
    const buffer   = await res.arrayBuffer();
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
  provider = 'kling',
  strength = 0.75,
  aspectRatio = '1:1',
  supabase = null,
  userId = 'shared',
}) {
  console.log(`[IMAGE_GEN] provider=${provider} prompt="${prompt.slice(0, 80)}"`);

  if (provider === 'openai') return generateOpenAI({ prompt, supabase, userId });
  return generateKlingO3({ prompt, imageUrl, strength, aspectRatio, supabase, userId });
}

// ─── Kling Omni 3 img2img ─────────────────────────────────────────
// Nový endpoint: image_urls je pole, nie single string
async function generateKlingO3({ prompt, imageUrl, strength, aspectRatio, supabase, userId }) {
  const falKey = getFalKey();

  console.log('[IMAGE_GEN][KLING_O3] Sending', { prompt: prompt.slice(0, 80), strength });

  const body = {
    prompt,
    image_urls: [imageUrl],   // ← O3 používa pole
    strength,
    aspect_ratio: aspectRatio,
  };

  const res = await fetch(FAL_API_URL_KLING_O3, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[KLING_O3] ${res.status}: ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  const rawUrl = data?.images?.[0]?.url || data?.image?.url;
  if (!rawUrl) throw new Error('[KLING_O3] No image URL in response');

  console.log('[IMAGE_GEN][KLING_O3] Done', { url: rawUrl.slice(0, 60) });
  return { imageUrl: await persistToSupabase(rawUrl, supabase, userId), provider: 'kling_o3' };
}

// ─── OpenAI gpt-image-1 (fallback pre safe bez reference) ────────
async function generateOpenAI({ prompt, supabase, userId }) {
  const apiKey = getOpenAIKey();

  const res = await fetch(OPENAI_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1536', quality: 'high' }),
  });

  if (!res.ok) throw new Error(`[OPENAI] ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data   = await res.json();
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('[OPENAI] No image returned');

  return { imageUrl: await persistBase64ToSupabase(base64, supabase, userId), provider: 'openai' };
}
