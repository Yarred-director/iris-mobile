import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { persistRemoteImage, createSignedMediaUrl, isUserOwnedMediaPath } from '../media/privateMedia.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import { fitImagePrompt, validateImagePrompt } from '../image/imagePromptBudget.js';
import { loadUserImageProvider, resolveFalImageProvider } from '../image/imageProvider.js';

const EDIT_ENDPOINTS = Object.freeze({
  openai_gpt_image_2: 'https://fal.run/openai/gpt-image-2/edit',
  grok_imagine_2: 'https://fal.run/xai/grok-imagine-image/v2.0/edit',
  kling_o3: 'https://fal.run/fal-ai/kling-image/o3/image-to-image',
});

const TEXT_ENDPOINTS = Object.freeze({
  openai_gpt_image_2: 'https://fal.run/openai/gpt-image-2',
  grok_imagine_2: 'https://fal.run/xai/grok-imagine-image/v2.0/text-to-image',
  kling_o3: 'https://fal.run/fal-ai/kling-image/o3/text-to-image',
});

const IMAGE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string' },
    caption: { type: 'string' },
    aspect_ratio: { type: 'string', enum: ['1:1', '3:4', '4:3', '9:16', '16:9'] },
  },
  required: ['prompt', 'caption', 'aspect_ratio'],
};

function clean(value, max = 4000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function getFalKey() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY missing in environment');
  return key;
}

function falPresetImageSize(aspectRatio) {
  return ({
    '1:1': 'square_hd',
    '3:4': 'portrait_4_3',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '16:9': 'landscape_16_9',
  })[aspectRatio] || 'auto';
}

function safeNamePattern(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionedPeople(message, directory = []) {
  const text = String(message || '');
  const matches = [];
  for (const person of directory || []) {
    if (person?.kind !== 'ai' || !person?.agent_active) continue;
    const names = [person.name, person.slug, ...(Array.isArray(person.aliases) ? person.aliases : [])]
      .map((item) => clean(item, 120))
      .filter(Boolean);
    if (!names.some((name) => new RegExp(`(^|[^\\p{L}\\p{N}_])${safeNamePattern(name)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text))) continue;
    if (!matches.some((item) => item.id === person.id)) matches.push(person);
  }
  return matches;
}

export function resolvePeopleImageTarget(message, directory = []) {
  const matches = mentionedPeople(message, directory);
  return matches.length === 1 ? matches[0] : null;
}

async function loadPeopleImageProfile(supabase, userId, person) {
  const { data: row, error: personError } = await supabase
    .from('iris_people')
    .select('id, user_id, slug, name, aliases, description, reference_image_bucket, reference_image_path, reference_image_url, metadata')
    .eq('user_id', userId)
    .eq('id', person.id)
    .maybeSingle();
  if (personError || !row) throw personError || new Error('people_image_person_missing');

  const { data: profile, error: profileError } = await supabase
    .from('iris_people_ai_profiles')
    .select('core_identity, personality, speech_style, active')
    .eq('user_id', userId)
    .eq('person_id', row.id)
    .maybeSingle();
  if (profileError || !profile?.active) throw profileError || new Error('people_image_profile_missing');
  return { person: row, profile };
}

async function loadReferenceUrl(person, userId) {
  if (person.reference_image_bucket && person.reference_image_path && isUserOwnedMediaPath(person.reference_image_bucket, person.reference_image_path, userId)) {
    return createSignedMediaUrl({ bucket: person.reference_image_bucket, path: person.reference_image_path, expiresIn: 900 });
  }
  if (person.reference_image_url) return String(person.reference_image_url);

  const anchor = person.metadata?.visual_anchor;
  if (anchor?.bucket && anchor?.path && isUserOwnedMediaPath(anchor.bucket, anchor.path, userId)) {
    return createSignedMediaUrl({ bucket: anchor.bucket, path: anchor.path, expiresIn: 900 });
  }
  return null;
}

async function composePeopleImageIntent({ message, recentChat, context }) {
  const client = getLLMClient('openai');
  const physicalIdentity = context.person.metadata?.physical_identity || {};
  const stylePreference = context.person.metadata?.style_preference || null;
  const history = (Array.isArray(recentChat) ? recentChat : [])
    .slice(-6)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      speaker: item?.speaker_name || (item?.role === 'assistant' ? 'Iris' : 'Yarred'),
      content: clean(item?.content, 600),
    }))
    .filter((item) => item.content);

  try {
    const response = await client.responses.create({
      model: MODELS.openaiUtility,
      reasoning: { effort: 'none' },
      max_output_tokens: 600,
      text: {
        format: {
          type: 'json_schema',
          name: 'iris_people_image_intent',
          strict: true,
          schema: IMAGE_RESULT_SCHEMA,
        },
      },
      input: [
        {
          role: 'system',
          content: `You compose one photorealistic image-generation prompt for a clearly adult persistent AI person inside Iris.\n- The TARGET PERSON is authoritative. Never substitute Iris or inherit Iris's face, body, outfit, visual state or autobiographical details.\n- Preserve every canonical physical trait exactly.\n- Use the latest user request for scene, pose and clothing. If unspecified, use only the target person's own canonical description/style; never import another person's current outfit.\n- If recent conversation mentions a setting relevant to the latest request, it may be used only when it clearly applies to the target person.\n- Exactly one target person unless the latest request explicitly asks for additional people.\n- Adult anatomy, realistic proportions, realistic skin and lighting.\n- prompt must be self-contained and under 2200 characters.\n- caption must be one short natural line in the user's current language, written as the target person if the user is directly asking for that person's photo; otherwise it may simply identify the target person.\nReturn only the schema.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            target_name: context.person.name,
            aliases: context.person.aliases || [],
            description: context.person.description || null,
            core_identity: context.profile.core_identity,
            physical_identity: physicalIdentity,
            style_preference: stylePreference,
            recent_context: history,
            latest_request: clean(message, 3500),
          }),
        },
      ],
    });
    if (response?.status !== 'completed') throw new Error('people_image_intent_incomplete');
    const parsed = JSON.parse(String(response.output_text || '').trim());
    if (!parsed?.prompt) throw new Error('people_image_intent_empty');
    return {
      prompt: clean(parsed.prompt, 2400),
      caption: clean(parsed.caption, 240) || context.person.name,
      aspectRatio: ['1:1', '3:4', '4:3', '9:16', '16:9'].includes(parsed.aspect_ratio) ? parsed.aspect_ratio : '3:4',
    };
  } catch (error) {
    console.log('[PEOPLE_IMAGE_INTENT_FALLBACK]', error?.code || error?.message || error);
    const physical = Object.entries(physicalIdentity).map(([key, value]) => `${key}: ${value}`).join(', ');
    return {
      prompt: `Photorealistic full adult portrait of ${context.person.name}. ${context.profile.core_identity}. ${physical ? `Canonical physical identity: ${physical}.` : ''} Latest requested scene: ${clean(message, 1200)}. Do not depict Iris. Realistic anatomy, skin texture, lighting and proportions.`,
      caption: context.person.name,
      aspectRatio: '3:4',
    };
  }
}

async function callFal(endpoint, provider, body) {
  const metrics = validateImagePrompt(provider, body.prompt);
  console.log('[PEOPLE_IMAGE_GEN_PAYLOAD]', { provider, ...metrics, referenceCount: Array.isArray(body.image_urls) ? body.image_urls.length : 0 });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Key ${getFalKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(30000, Math.min(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 240000), 300000))),
  });
  if (!response.ok) {
    const error = new Error(`[PEOPLE_IMAGE:${provider}] Fal HTTP ${response.status}`);
    error.code = `fal_http_${response.status}`;
    error.status = response.status;
    error.provider = provider;
    throw error;
  }
  return response.json();
}

async function generatePeopleImage({ prompt, referenceUrl, provider, aspectRatio, userId, subjectName }) {
  const resolved = resolveFalImageProvider(provider);
  if (!TEXT_ENDPOINTS[resolved]) throw new Error(`unsupported_people_image_provider:${resolved}`);
  const subjectPrefix = `${subjectName} is the clearly adult target person. Preserve only ${subjectName}'s identity; do not substitute Iris. `;
  const finalPrompt = fitImagePrompt({ provider: resolved, prompt, prefix: subjectPrefix });

  let data;
  if (referenceUrl) {
    if (resolved === 'openai_gpt_image_2') {
      data = await callFal(EDIT_ENDPOINTS[resolved], resolved, {
        prompt: finalPrompt,
        image_urls: [referenceUrl],
        image_size: falPresetImageSize(aspectRatio),
        quality: 'high',
        num_images: 1,
        output_format: 'png',
      });
    } else if (resolved === 'grok_imagine_2') {
      data = await callFal(EDIT_ENDPOINTS[resolved], resolved, {
        prompt: finalPrompt,
        image_urls: [referenceUrl],
        resolution: '2k',
        quality: 'medium',
        num_images: 1,
        aspect_ratio: aspectRatio,
        output_format: 'png',
      });
    } else {
      data = await callFal(EDIT_ENDPOINTS[resolved], resolved, {
        prompt: `@Image1 ${finalPrompt}`,
        image_urls: [referenceUrl],
        resolution: '1K',
        result_type: 'single',
        num_images: 1,
        aspect_ratio: aspectRatio,
        output_format: 'png',
      });
    }
  } else if (resolved === 'openai_gpt_image_2') {
    data = await callFal(TEXT_ENDPOINTS[resolved], resolved, {
      prompt: finalPrompt,
      image_size: falPresetImageSize(aspectRatio),
      quality: 'high',
      num_images: 1,
      output_format: 'png',
    });
  } else if (resolved === 'grok_imagine_2') {
    data = await callFal(TEXT_ENDPOINTS[resolved], resolved, {
      prompt: finalPrompt,
      resolution: '2k',
      quality: 'medium',
      num_images: 1,
      aspect_ratio: aspectRatio,
      output_format: 'png',
    });
  } else {
    data = await callFal(TEXT_ENDPOINTS[resolved], resolved, {
      prompt: finalPrompt,
      resolution: '1K',
      result_type: 'single',
      num_images: 1,
      aspect_ratio: aspectRatio,
      output_format: 'png',
    });
  }

  const image = data?.images?.[0] || data?.image || null;
  if (!image?.url) throw new Error('people_image_missing_output');
  const persisted = await persistRemoteImage({
    sourceUrl: image.url,
    userId,
    contentType: image.content_type || 'image/png',
    signedUrlSeconds: 86400,
  });
  return { ...persisted, provider: resolved, usedReference: Boolean(referenceUrl) };
}

async function persistGeneratedVisualAnchor({ supabase, userId, context, result }) {
  if (result.usedReference || !result.imageBucket || !result.imagePath) return;
  const metadata = {
    ...(context.person.metadata || {}),
    visual_anchor: {
      bucket: result.imageBucket,
      path: result.imagePath,
      source: 'first_generated_people_image',
      updated_at: new Date().toISOString(),
    },
  };
  const { error } = await supabase
    .from('iris_people')
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', context.person.id);
  if (error) console.log('[PEOPLE_IMAGE_ANCHOR_ERROR]', error.code || error.message);
}

export async function handlePeopleImageRequest({ message, userId, supabase, person, recentChat = [] }) {
  const context = await loadPeopleImageProfile(supabase, userId, person);
  const usage = await consumeDailyUsage(supabase, userId, 'image');
  if (!usage.allowed) {
    return {
      handled: true,
      imageUrl: null,
      imageBucket: null,
      imagePath: null,
      caption: `Dnešný limit obrázkov je vyčerpaný (${usage.used}/${usage.limit}).`,
      usage,
      person: context.person,
    };
  }

  const intent = await composePeopleImageIntent({ message, recentChat, context });
  const referenceUrl = await loadReferenceUrl(context.person, userId);
  const provider = await loadUserImageProvider(getSupabaseAdmin(), userId);
  try {
    const result = await generatePeopleImage({
      prompt: intent.prompt,
      referenceUrl,
      provider,
      aspectRatio: intent.aspectRatio,
      userId,
      subjectName: context.person.name,
    });
    await persistGeneratedVisualAnchor({ supabase, userId, context, result });
    return {
      handled: true,
      imageUrl: result.imageUrl || null,
      imageBucket: result.imageBucket || null,
      imagePath: result.imagePath || null,
      caption: intent.caption || context.person.name,
      usage,
      provider: result.provider,
      person: context.person,
      usedReference: result.usedReference,
    };
  } catch (error) {
    console.log('[PEOPLE_IMAGE_ERROR]', { message: error?.message, code: error?.code || null, provider: error?.provider || provider });
    return {
      handled: true,
      imageUrl: null,
      imageBucket: null,
      imagePath: null,
      caption: `${context.person.name} sa mi teraz nepodarilo vytvoriť. Skús to ešte raz o chvíľu.`,
      usage,
      provider,
      person: context.person,
      errorCode: error?.code || 'people_image_generation_failed',
    };
  }
}
