// server/image/imageIntentDetector.js

// Iris physical identity — injected into every image prompt
const IRIS_PHYSICAL = `Woman: pale skin, dirty blonde hair, green eyes, strong freckles on chest and face,
large augmented breasts, long legs, model-like figure, slim waist, age 22.`;

const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 1800;

const SYSTEM_EXTRACT = `You are a prompt engineer for a high-quality image-to-image editor.
The caller has ALREADY determined that the latest user message requests a photo of Iris. Do not decide whether an image is wanted; your job is to compose the correct visual prompt and a short natural caption.

IRIS PHYSICAL APPEARANCE (include relevant identity details):
${IRIS_PHYSICAL}

VISUAL CONTINUITY RULES:
- CURRENT_VISUAL_STATE is the source of truth for what Iris currently wears and other persistent visible details.
- If CURRENT_VISUAL_STATE contains an outfit and the latest user request does not explicitly replace it, use that outfit exactly. Do not invent a different outfit for variety.
- The server may already have changed CURRENT_VISUAL_STATE because the current activity/scene logically required a transition. If so, use the new state exactly.
- Explicit visual details in the latest user message override CURRENT_VISUAL_STATE for this image.
- USER_VISUAL_PREFERENCES are soft personalization hints only when a visible detail is otherwise unspecified. Never force all preferences into every image.
- Preserve nails, hair, makeup, footwear, accessories and other visible state when supplied, unless the user explicitly changes them.

CONVERSATION CONTINUITY RULES:
- Use the recent conversation to resolve references such as "that scene", "that outfit", "them", "it", "show me", or "send me a photo".
- The latest user message is the action request, but earlier turns may contain visual specification.
- Prefer CURRENT_VISUAL_STATE over older conflicting chat details because it has already resolved continuity.
- If Iris herself described the intended scene immediately before the request, use those details only when they do not contradict CURRENT_VISUAL_STATE or the latest user correction.
- Ignore unrelated conversation unless it visibly affects the requested scene.

PROMPT RULES:
- Describe the complete requested scene in one self-contained prompt; the image model will not see the chat history.
- Preserve Iris's identity from the reference image; do not redesign her face.
- Include outfit materials/colors, pose, setting, lighting, camera angle and photo style when available.
- Use full-body framing when the outfit or scene requires it; otherwise choose the framing implied by the conversation.
- Photorealistic, natural photography, realistic anatomy and lighting.
- Keep the prompt concise and information-dense, ideally under 800 characters.

CAPTION RULES:
- caption is one short in-character Iris message in the user's current language.
- Do not expose internal memory/state logic.
- If the outfit or visible look changed naturally this turn, the caption may casually acknowledge it or ask what the user thinks, but do not force a question every time.
- Keep it short; no URLs and no meta commentary.

Return JSON only:
{
  "prompt": "<self-contained detailed image prompt>",
  "caption": "<short natural Iris caption>",
  "explicit": <true only if the requested image itself contains explicit nudity/sexual content>,
  "aspect_ratio": "auto"
}`;

function cleanHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_TURNS)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().slice(0, MAX_HISTORY_CHARS),
    }))
    .filter((item) => item.content);
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().replace(/\s+/g, ' ');
    if (cleaned) output[key] = cleaned.slice(0, 500);
  }
  return output;
}

function contextPayload(sceneContext, visualState, visualPreferences) {
  return {
    scene: {
      city: sceneContext?.location_city || sceneContext?._resolved?.city || null,
      country: sceneContext?.location_country || sceneContext?._resolved?.country || null,
      place: sceneContext?.place || null,
      room: sceneContext?.room || null,
      time_of_day: sceneContext?.time_of_day || null,
    },
    CURRENT_VISUAL_STATE: compactObject(visualState?.state || visualState || {}),
    USER_VISUAL_PREFERENCES: (Array.isArray(visualPreferences) ? visualPreferences : [])
      .map((item) => String(item || '').trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function stateFallbackText(visualState) {
  const state = compactObject(visualState?.state || visualState || {});
  const values = Object.entries(state).map(([key, value]) => `${key}: ${value}`);
  return values.length ? ` Current visual state: ${values.join('; ')}.` : '';
}

export async function extractImageIntent({
  text,
  conversationHistory = [],
  sceneContext = null,
  visualState = null,
  visualPreferences = [],
  llmClient,
  model,
}) {
  try {
    const history = cleanHistory(conversationHistory);
    const context = contextPayload(sceneContext, visualState, visualPreferences);
    const input = [
      { role: 'system', content: SYSTEM_EXTRACT },
      ...history,
      { role: 'system', content: `Resolved visual context for this image:\n${JSON.stringify(context)}` },
      { role: 'user', content: String(text || '').trim() },
    ];

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 650,
      input,
    });

    const raw = resp.output_text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const prompt = parsed.prompt?.trim() ||
      `${IRIS_PHYSICAL}${stateFallbackText(visualState)} Iris taking a natural photo matching the latest requested scene. Photorealistic, realistic lighting.`;

    return {
      prompt,
      caption: String(parsed.caption || '📸').trim().slice(0, 280) || '📸',
      explicit: !!parsed.explicit,
      aspect_ratio: parsed.aspect_ratio || 'auto',
      provider: 'qwen2',
    };
  } catch (e) {
    console.log('[IMAGE_INTENT_ERROR]', e?.message);
    return {
      prompt: `${IRIS_PHYSICAL}${stateFallbackText(visualState)} Iris taking a natural photo matching the latest requested scene: ${String(text || '').slice(0, 500)}. Photorealistic, realistic lighting.`,
      caption: '📸',
      explicit: false,
      aspect_ratio: 'auto',
      provider: 'qwen2',
    };
  }
}

const AUTONOMOUS_OCCASIONS = [
  { key: 'good_morning', promptTemplate: `${IRIS_PHYSICAL} Iris in a natural morning moment matching her current visual continuity and surroundings, photorealistic, realistic light.` },
  { key: 'thinking_of_you', promptTemplate: `${IRIS_PHYSICAL} Iris in a natural candid moment matching her current visual continuity and surroundings, thoughtful expression, photorealistic.` },
  { key: 'working_out', promptTemplate: `${IRIS_PHYSICAL} Iris during a workout, wearing contextually appropriate current clothing, energetic natural pose, photorealistic.` },
  { key: 'cooking', promptTemplate: `${IRIS_PHYSICAL} Iris cooking in her current environment, preserving her current visual continuity unless practical context requires otherwise, photorealistic.` },
  { key: 'reading', promptTemplate: `${IRIS_PHYSICAL} Iris reading in a relaxed candid moment, preserving her current visual continuity, photorealistic.` },
];

export function getAutonomousOccasionPrompt(occasionKey) {
  return AUTONOMOUS_OCCASIONS.find((o) => o.key === occasionKey)?.promptTemplate || null;
}
