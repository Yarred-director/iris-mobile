// server/image/imageGen.js

const FAL_API_URL_KLING = 'https://fal.run/fal-ai/kling-image/v3/image-to-image';
const FAL_API_URL_XAI = 'https://fal.run/xai/grok-imagine-image/edit';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';

function getFalKey() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY missing in environment');
  return key;
}

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing in environment');
  return key;
}

async function saveGeneratedImage(base64, supabase, userId) {
  if (!supabase) return null;

  const bytes = Buffer.from(base64, 'base64');
  const filePath = `generated/${userId}/${Date.now()}.png`;

  const upload = await supabase.storage
    .from('iris-photos')
    .upload(filePath, bytes, {
      contentType: 'image/png',
      upsert: false,
    });

  if (upload.error) {
    throw new Error(upload.error.message);
  }

  const publicData = supabase.storage
    .from('iris-photos')
    .getPublicUrl(filePath);

  return publicData?.data?.publicUrl || null;
}

export async function generateIrisImage({
  prompt,
  imageUrl,
  provider = 'openai',
  strength = 0.75,
  aspectRatio = '1:1',
  supabase = null,
  userId = 'shared',
}) {
  if (provider === 'openai') {
    return generateOpenAI({ prompt, supabase, userId });
  }

  const falKey = getFalKey();

  if (provider === 'xai') {
    return generateXAI({ prompt, imageUrl, strength, falKey });
  }

  return generateKling({ prompt, imageUrl, strength, aspectRatio, falKey });
}

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
    throw new Error(err);
  }

  const data = await res.json();
  const base64 = data?.data?.[0]?.b64_json;

  if (!base64) {
    throw new Error('No image returned');
  }

  const imageUrl = await saveGeneratedImage(base64, supabase, userId);

  return {
    imageUrl,
    provider: 'openai',
  };
}

async function generateKling({ prompt, imageUrl, strength, aspectRatio, falKey }) {
  const res = await fetch(FAL_API_URL_KLING, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
      strength,
      aspect_ratio: aspectRatio,
    }),
  });

  const data = await res.json();

  return {
    imageUrl: data?.images?.[0]?.url || data?.image?.url,
    seed: data?.seed,
    provider: 'kling',
  };
}

async function generateXAI({ prompt, imageUrl, strength, falKey }) {
  const res = await fetch(FAL_API_URL_XAI, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
      strength,
    }),
  });

  const data = await res.json();

  return {
    imageUrl: data?.images?.[0]?.url || data?.image?.url,
    seed: data?.seed,
    provider: 'xai',
  };
}
