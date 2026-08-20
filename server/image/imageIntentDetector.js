// server/image/imageIntentDetector.js

// Iris physical identity — injected into every image prompt
const IRIS_PHYSICAL = `Woman: pale skin, dirty blonde hair, green eyes, strong freckles on chest and face,
large augmented breasts, long legs, model-like figure, slim waist, age 22.`;

const BODY_PROPORTION_GUARDRAILS = `Natural adult female proportions and realistic anatomy. Keep a natural head-to-body scale: the head must not be enlarged relative to the shoulders, torso or legs. Preserve Iris's long-legged model-like silhouette, realistic shoulder width and torso length, and anatomically plausible limbs. No chibi, bobblehead, childlike or doll-like proportions.`;
const BUST_VISIBILITY_GUARDRAIL = `Medium or three-quarter framing from head to at least the waist, preferably upper thighs when the scene allows. Keep Iris's entire augmented bust and enough torso visibly in frame; do not crop at the collarbones or shoulders and do not turn the scene into a tight beauty headshot.`;

const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 1800;

const SYSTEM_EXTRACT = `You are a prompt engineer for a high-quality image-to-image editor.
The caller has ALREADY determined that the latest user message requests a photo of Iris. Do not decide whether an image is wanted; your job is to compose the correct visual prompt and a short natural caption.

IRIS PHYSICAL APPEARANCE (include relevant identity details):
${IRIS_PHYSICAL}

BODY PROPORTION RULES (mandatory for every generated image):
${BODY_PROPORTION_GUARDRAILS}
- These are composition/anatomy constraints, not an outfit or pose prescription.
- For full-body, mirror, bed, standing, seated or wide shots, explicitly preserve natural adult head-to-body scale and Iris's long-legged silhouette.
- Never enlarge the head merely to preserve facial identity from reference photos.
- Facial reference images define identity only; they must not change body scale or create a large-head portrait pasted onto a smaller body.

VISUAL CONTINUITY RULES:
- CURRENT_VISUAL_STATE is the source of truth for Iris's last established visible state, but an explicitly planned or corrected scene in the immediate conversation may change it for the requested image.
- If CURRENT_VISUAL_STATE contains an outfit and the latest request/history does not explicitly replace it, use that outfit exactly. Do not invent a different outfit for variety.
- The server may already have changed CURRENT_VISUAL_STATE because the current activity/scene logically required a transition. If so, use the new state exactly unless the immediate planned image explicitly changes a visible detail.
- Explicit visual details in the latest user message override CURRENT_VISUAL_STATE for this image.
- USER_VISUAL_PREFERENCES are soft personalization hints only when a visible detail is otherwise unspecified. Never force all preferences into every image.
- Preserve nails, hair, makeup, footwear, accessories and other visible state when supplied, unless the user explicitly changes them.

CONVERSATION CONTINUITY RULES:
- Use the recent conversation to resolve references such as "that scene", "that outfit", "them", "it", "show me", "send me a photo", "pošli mi tú fotku", or short approval such as "yes, exactly".
- The latest user message is the action request, but earlier turns may contain the actual visual specification.
- If the immediately preceding assistant turn clearly describes/proposes a specific image and the user accepts it or asks to send "that photo", inherit that planned scene as the authoritative image specification. Do not fall back to a generic portrait merely because CURRENT_VISUAL_STATE still reflects the previous generated image.
- If the latest message is a correction to a just-generated/planned image (for example larger neckline, different pose, wider framing, different shoes), preserve every unspecified scene/outfit/detail from that prior image plan and change only what the user corrected.
- Prefer CURRENT_VISUAL_STATE over genuinely older conflicting chat details, but never let stale state erase an explicit immediate planned-scene change.
- Ignore unrelated conversation unless it visibly affects the requested scene.

FRAMING / ANATOMY LANGUAGE RULES:
- Interpret anatomy and framing separately. Phrases such as "augmented chest", "full chest", "larger bust", "cleavage", "výstrih", "dekolt" or equivalent normally describe Iris's bust/visibility, not a request for a chest-up portrait crop.
- When the user asks for a larger neckline, cleavage, bust/chest visibility, or wants Iris's augmented bust visibly included, frame from the head to at least the waist (or upper thighs when appropriate) so the entire bust and enough torso are visible. Never crop at the collarbones/shoulders in that case.
- "Full chest" used together with augmented/breast/cleavage language means the full augmented bust should be visibly in frame; it does NOT mean a tight head-and-chest portrait.
- Do not turn a fantasy/warrior/outfit scene into a beauty headshot unless the user explicitly asks for a portrait or close-up.

PROMPT RULES:
- Describe the complete requested scene in one self-contained prompt; the image model will not see the chat history.
- Preserve Iris's identity from the reference images; do not redesign her face.
- Include outfit materials/colors, pose, setting, lighting, camera angle and photo style when available.
- Use full-body framing when the outfit or scene requires it; otherwise choose the framing implied by the conversation and the framing/anatomy rules above.
- Photorealistic, natural photography, realistic anatomy and lighting.
- Keep the scene description concise and information-dense, ideally under 650 characters so mandatory proportion rules remain intact.

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

function withProportionGuardrails(prompt) {
  const scene = String(prompt || '').trim();
  return `${BODY_PROPORTION_GUARDRAILS} ${scene}`.trim();
}

function asksForBustVisibility(text, history = []) {
  const recent = [
    ...(Array.isArray(history) ? history.slice(-6).map((item) => String(item?.content || '')) : []),
    String(text || ''),
  ].join(' ').toLowerCase();
  return /\b(?:augmented\s+(?:chest|breasts?|bust)|full\s+chest|larger\s+(?:bust|breasts?)|bigger\s+(?:bust|breasts?)|cleavage|neckline|bust)\b|výstrih|vystrih|dekolt|poprsie|prsia/.test(recent);
}

function applyConversationFramingGuardrails(prompt, text, history) {
  const scene = withProportionGuardrails(prompt);
  return asksForBustVisibility(text, history) ? `${scene} ${BUST_VISIBILITY_GUARDRAIL}` : scene;
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
  const history = cleanHistory(conversationHistory);
  try {
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
    const scenePrompt = parsed.prompt?.trim() ||
      `${IRIS_PHYSICAL}${stateFallbackText(visualState)} Iris taking a natural photo matching the latest requested scene. Photorealistic, realistic lighting.`;

    return {
      prompt: applyConversationFramingGuardrails(scenePrompt, text, history),
      caption: String(parsed.caption || '📸').trim().slice(0, 280) || '📸',
      explicit: !!parsed.explicit,
      aspect_ratio: parsed.aspect_ratio || 'auto',
      provider: 'qwen2',
    };
  } catch (e) {
    console.log('[IMAGE_INTENT_ERROR]', e?.message);
    return {
      prompt: applyConversationFramingGuardrails(`${IRIS_PHYSICAL}${stateFallbackText(visualState)} Iris taking a natural photo matching the latest requested scene: ${String(text || '').slice(0, 500)}. Photorealistic, realistic lighting.`, text, history),
      caption: '📸',
      explicit: false,
      aspect_ratio: 'auto',
      provider: 'qwen2',
    };
  }
}

const AUTONOMOUS_OCCASIONS = [
  { key: 'good_morning', promptTemplate: withProportionGuardrails(`${IRIS_PHYSICAL} Iris in a natural morning moment matching her current visual continuity and surroundings, photorealistic, realistic light.`) },
  { key: 'thinking_of_you', promptTemplate: withProportionGuardrails(`${IRIS_PHYSICAL} Iris in a natural candid moment matching her current visual continuity and surroundings, thoughtful expression, photorealistic.`) },
  { key: 'working_out', promptTemplate: withProportionGuardrails(`${IRIS_PHYSICAL} Iris during a workout, wearing contextually appropriate current clothing, energetic natural pose, photorealistic.`) },
  { key: 'cooking', promptTemplate: withProportionGuardrails(`${IRIS_PHYSICAL} Iris cooking in her current environment, preserving her current visual continuity unless practical context requires otherwise, photorealistic.`) },
  { key: 'reading', promptTemplate: withProportionGuardrails(`${IRIS_PHYSICAL} Iris reading in a relaxed candid moment, preserving her current visual continuity, photorealistic.`) },
];

export function getAutonomousOccasionPrompt(occasionKey) {
  return AUTONOMOUS_OCCASIONS.find((o) => o.key === occasionKey)?.promptTemplate || null;
}