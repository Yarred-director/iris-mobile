// server/image/imageIntentDetector.js

const ADULT_IDENTITY_RULE = `Iris is a clearly adult woman. Never depict her as a minor, underage, childlike, teen-like, or with minor-like body proportions.`;
const BODY_PROPORTION_GUARDRAILS = `Natural adult female anatomy and realistic head-to-body scale. Preserve the proportions defined by USER_DEFINED_PHYSICAL_IDENTITY when present. Never enlarge the head relative to shoulders or torso merely to preserve the face reference. No chibi, bobblehead, childlike or doll-like proportions, distorted anatomy, shortened torso, or malformed limbs.`;
const BUST_VISIBILITY_GUARDRAIL = `Frame from the head to at least the waist, preferably upper thighs when the scene allows. Keep the entire established bust and enough torso visibly in frame; do not crop at the collarbones or shoulders and do not turn the scene into a tight beauty headshot.`;

const FRAMING_DIRECTIVES = Object.freeze({
  close_up: 'Close-up portrait framing. Use this only because the requested photo is specifically about facial identity, makeup, a facial detail, or an emotional expression.',
  half_body: 'Half-body composition from head to hips/waist, keeping shoulders, torso and body context clearly visible; not a face-only portrait.',
  three_quarter: 'Three-quarter composition from head to upper thighs or knees, showing Iris and her body/outfit as the primary subject while retaining useful environment context.',
  full_body: 'Full-body composition from head to feet with natural perspective, showing the complete outfit/body pose and enough environment to make the scene believable.',
});

const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 1800;

const SYSTEM_EXTRACT = `You are a prompt engineer for a high-quality image-to-image editor.
The caller has ALREADY determined that the latest user message requests a photo of Iris. Do not decide whether an image is wanted; compose the correct visual prompt, framing choice and a short natural caption.

ADULT IDENTITY RULE (mandatory):
${ADULT_IDENTITY_RULE}

PHYSICAL IDENTITY RULES:
- USER_DEFINED_PHYSICAL_IDENTITY is the authority for Iris's enduring body traits.
- Preserve every established body trait from it consistently across generated photos unless the user explicitly changes it.
- Do not invent a fixed bust size, height, waist, hips, legs, body build or other enduring body trait when USER_DEFINED_PHYSICAL_IDENTITY does not establish it.
- Face reference images define facial identity only. Never infer body proportions from face references.

BODY PROPORTION RULES (mandatory for every generated image):
${BODY_PROPORTION_GUARDRAILS}

VISUAL CONTINUITY RULES:
- CURRENT_VISUAL_STATE is the source of truth for Iris's last established outfit and temporary visible styling, but an explicitly planned or corrected scene in the immediate conversation may change it for the requested image.
- If CURRENT_VISUAL_STATE contains an outfit and the latest request/history does not explicitly replace it, use that outfit exactly. Do not invent a different outfit or color for variety.
- Explicit visual details in the latest user message override CURRENT_VISUAL_STATE for this image.
- USER_VISUAL_PREFERENCES are soft personalization hints only when a visible detail is otherwise unspecified.
- Preserve nails, hair, makeup, footwear, accessories and other visible state when supplied, unless the user explicitly changes them.

CONVERSATION CONTINUITY RULES:
- Use recent conversation to resolve references such as "that scene", "that outfit", "show me", "send me a photo", "pošli mi tú fotku", or short approval such as "yes, exactly".
- If the immediately preceding assistant turn clearly described a specific image and the user accepts it or asks for "that photo", inherit that planned scene as the authoritative image specification.
- If the latest message corrects a just-generated/planned image, preserve every unspecified scene/outfit/detail and change only what the user corrected.
- Prefer CURRENT_VISUAL_STATE over genuinely older conflicting chat details, but never let stale state erase an explicit immediate planned-scene change.
- CURRENT_ACTIVITY_STATE is authoritative for what Iris is doing/planning. The image and caption must not invent a beach, sea trip, coffee, shower, workout, return-home event, or other activity that is not supported by current activity continuity/recent conversation.

FRAMING DECISION — IMPORTANT:
- Choose one framing value: close_up | half_body | three_quarter | full_body.
- Default personal-photo framing is three_quarter, NOT a face close-up.
- Prefer full_body when the outfit, complete look, standing pose, travel/location, workout/activity, body silhouette, or overall styling matters.
- Prefer three_quarter for lingerie/fashion, seated/bed scenes, casual selfies and most attractive personal photos where both face and body matter.
- Prefer half_body when the environment or pose makes full/three-quarter impractical but body context still matters.
- Use close_up ONLY when the user explicitly asks for a portrait/face detail OR the main purpose of the image is a facial emotion/expression, makeup, eyes, tears, smile, etc.
- Never choose close_up simply because face references exist.
- Anatomy words such as bust/chest/cleavage/výstrih/dekolt describe visibility/body traits; they are NOT requests for a chest-up portrait crop.

PROMPT RULES:
- Describe the complete requested scene in one self-contained prompt; the image model will not see chat history.
- Preserve Iris's exact facial identity from the reference images without redesigning her face.
- Include the full USER_DEFINED_PHYSICAL_IDENTITY description when present, especially body traits relevant to the shot.
- Include exact outfit materials/colors, pose, setting, lighting, camera angle and photography style when available.
- If the user specifies black clothing, say it MUST remain black and must not drift to white/beige/ivory.
- Photorealistic, realistic skin/anatomy and believable lighting.
- Keep scene description concise and information-dense.

CAPTION RULES:
- caption is one short in-character Iris message in the user's current language.
- Do not expose internal memory/state logic.
- Do not invent future plans or locations in the caption. Mention an activity only when supported by CURRENT_ACTIVITY_STATE/recent conversation.
- Keep it short; no URLs and no meta commentary.

Return JSON only:
{
  "prompt": "<self-contained detailed image prompt>",
  "caption": "<short natural Iris caption>",
  "explicit": <true only if the requested image itself contains explicit nudity/sexual content>,
  "framing": "close_up|half_body|three_quarter|full_body",
  "aspect_ratio": "auto|1:1|3:4|4:3|9:16|16:9"
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
    if (cleaned) output[key] = cleaned.slice(0, 700);
  }
  return output;
}

function contextPayload(sceneContext, visualState, physicalIdentity, activityState, visualPreferences) {
  return {
    scene: {
      city: sceneContext?.location_city || sceneContext?._resolved?.city || null,
      country: sceneContext?.location_country || sceneContext?._resolved?.country || null,
      place: sceneContext?.place || null,
      room: sceneContext?.room || null,
      time_of_day: sceneContext?.time_of_day || null,
    },
    CURRENT_VISUAL_STATE: compactObject(visualState?.state || visualState || {}),
    USER_DEFINED_PHYSICAL_IDENTITY: compactObject(physicalIdentity || {}),
    CURRENT_ACTIVITY_STATE: activityState || {},
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

function physicalFallbackText(physicalIdentity) {
  const body = String(physicalIdentity?.body_description || '').trim();
  return body ? ` User-defined persistent body identity: ${body}.` : '';
}

function normalizeFraming(value) {
  return Object.prototype.hasOwnProperty.call(FRAMING_DIRECTIVES, value) ? value : 'three_quarter';
}

function resolveAspectRatio(value, framing) {
  const allowed = new Set(['auto', '1:1', '3:4', '4:3', '9:16', '16:9']);
  const requested = allowed.has(value) ? value : 'auto';
  if (requested !== 'auto') return requested;
  return framing === 'close_up' ? '1:1' : '3:4';
}

function withCoreGuardrails(prompt, framing) {
  const scene = String(prompt || '').trim();
  return `${ADULT_IDENTITY_RULE} ${BODY_PROPORTION_GUARDRAILS} ${FRAMING_DIRECTIVES[framing]} ${scene}`.trim();
}

function asksForBustVisibility(text, history = []) {
  const recent = [
    ...(Array.isArray(history) ? history.slice(-6).map((item) => String(item?.content || '')) : []),
    String(text || ''),
  ].join(' ').toLowerCase();
  return /\b(?:augmented\s+(?:chest|breasts?|bust)|full\s+chest|larger\s+(?:bust|breasts?)|bigger\s+(?:bust|breasts?)|cleavage|neckline|bust|cup\s*(?:size)?)\b|výstrih|vystrih|dekolt|poprsie|prsia/.test(recent);
}

function applyConversationFramingGuardrails(prompt, text, history, framing) {
  const safeFraming = asksForBustVisibility(text, history) && framing === 'close_up' ? 'three_quarter' : framing;
  const scene = withCoreGuardrails(prompt, safeFraming);
  return {
    framing: safeFraming,
    prompt: asksForBustVisibility(text, history) ? `${scene} ${BUST_VISIBILITY_GUARDRAIL}` : scene,
  };
}

export async function extractImageIntent({
  text,
  conversationHistory = [],
  sceneContext = null,
  visualState = null,
  physicalIdentity = null,
  activityState = null,
  visualPreferences = [],
  llmClient,
  model,
}) {
  const history = cleanHistory(conversationHistory);
  try {
    const context = contextPayload(sceneContext, visualState, physicalIdentity, activityState, visualPreferences);
    const input = [
      { role: 'system', content: SYSTEM_EXTRACT },
      ...history,
      { role: 'system', content: `Resolved visual/activity context for this image:\n${JSON.stringify(context)}` },
      { role: 'user', content: String(text || '').trim() },
    ];

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 750,
      input,
    });

    const raw = resp.output_text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const requestedFraming = normalizeFraming(parsed.framing);
    const scenePrompt = parsed.prompt?.trim() ||
      `Iris, a clearly adult woman, taking a natural photo matching the requested scene.${physicalFallbackText(physicalIdentity)}${stateFallbackText(visualState)} Photorealistic, realistic lighting.`;
    const framed = applyConversationFramingGuardrails(scenePrompt, text, history, requestedFraming);

    return {
      prompt: framed.prompt,
      caption: String(parsed.caption || '📸').trim().slice(0, 280) || '📸',
      explicit: !!parsed.explicit,
      framing: framed.framing,
      aspect_ratio: resolveAspectRatio(parsed.aspect_ratio, framed.framing),
      provider: 'qwen2',
    };
  } catch (e) {
    console.log('[IMAGE_INTENT_ERROR]', e?.message);
    const fallbackFraming = asksForBustVisibility(text, history) ? 'three_quarter' : 'three_quarter';
    const scene = `Iris, a clearly adult woman, taking a natural photo matching the latest requested scene: ${String(text || '').slice(0, 500)}.${physicalFallbackText(physicalIdentity)}${stateFallbackText(visualState)} Photorealistic, realistic lighting.`;
    const framed = applyConversationFramingGuardrails(scene, text, history, fallbackFraming);
    return {
      prompt: framed.prompt,
      caption: '📸',
      explicit: false,
      framing: framed.framing,
      aspect_ratio: resolveAspectRatio('auto', framed.framing),
      provider: 'qwen2',
    };
  }
}

const AUTONOMOUS_OCCASIONS = [
  { key: 'good_morning', promptTemplate: withCoreGuardrails('Iris in a natural morning moment matching her current visual continuity and surroundings, photorealistic, realistic light.', 'three_quarter') },
  { key: 'thinking_of_you', promptTemplate: withCoreGuardrails('Iris in a natural candid moment matching her current visual continuity and surroundings, thoughtful expression, photorealistic.', 'half_body') },
  { key: 'working_out', promptTemplate: withCoreGuardrails('Iris during a workout, wearing contextually appropriate current clothing, energetic natural pose, photorealistic.', 'full_body') },
  { key: 'cooking', promptTemplate: withCoreGuardrails('Iris cooking in her current environment, preserving current visual continuity, photorealistic.', 'three_quarter') },
  { key: 'reading', promptTemplate: withCoreGuardrails('Iris reading in a relaxed candid moment, preserving current visual continuity, photorealistic.', 'three_quarter') },
];

export function getAutonomousOccasionPrompt(occasionKey) {
  return AUTONOMOUS_OCCASIONS.find((o) => o.key === occasionKey)?.promptTemplate || null;
}
