import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const SYSTEM_PROMPT = `You are intentJudge for a global companion chat system. Your ONLY job is to classify the latest user message for routing, intimacy intensity, and visual-continuity signals.

GLOBAL RULES:
- The user can write in ANY language. Classify by semantic meaning, never by language-specific keywords.
- Be conservative: choose the LOWEST heat level that clearly fits the user's current behavior.
- Current user behavior sets the maximum response heat. Never infer permission to escalate beyond it.
- A stored or inferred preference is only a style prior, never consent and never a reason to raise the current heat level.
- Output valid JSON only. Do not roleplay or answer the user.

HEAT LEVELS:
0 = normal conversation, friendship, jokes, neutral flirting with no romantic physical action.
1 = soft romance: affectionate flirting, holding hands, hugs, cuddling, stroking hair/face, gentle kisses, comforting touch. No sexualized touching.
2 = sensual / foreplay territory: sexualized touching such as thigh, hips, butt, breasts, grinding, sensual undressing, clear arousal, making out that becomes sexual, foreplay. This is NOT explicit sex yet.
3 = explicit sexual activity: masturbation, oral sex, genital touching, penetration, explicit sex acts, orgasm-focused sexual scene.

IMPORTANT HEAT RULES:
- A kiss + hug => heat 1.
- A kiss + grabbing butt/thigh/breast => heat 2, NOT heat 3.
- Heat 2 must not automatically become heat 3.
- Heat 3 can still be gentle. Rough/vulgar intensity is a separate style dimension and should be marked rough only when the user explicitly behaves or asks that way.

INTENSITY STYLE:
neutral | gentle | playful | sensual | rough
Mirror the user's actual style. Do not label rough merely because heat_level is 3.

CONTINUATION:
If the latest message is a short continuation such as "yes", "continue", an emoji, or equivalent in any language, and context shows an active intimate heat level, set continues_intimate_scene=true and preserve that prior heat unless the user clearly de-escalates or changes topic.

NICKNAME MEMORY:
- Detect a nickname only when the user clearly gives or uses a nickname FOR IRIS.
- iris_nickname must contain the nickname exactly as the user uses it, or null.
- Never interpret Iris's nickname as a nickname for the user.

PREFERENCE LEARNING:
- preferred_heat_level may be 1, 2, 3, or null.
- preferred_style may be gentle, playful, sensual, rough, or null.
- Set a preference only if the user explicitly states it OR at least two separate recent user turns clearly support the same preference.
- Do not derive a durable preference from one isolated intimate message.

VISUAL CONTINUITY:
- CURRENT_VISUAL_STATE is what Iris is presently wearing/visibly presenting. Preserve it by default.
- Never change Iris's outfit, nails, hair, makeup, footwear or accessories merely for novelty.
- visual_change="explicit" only when the user directly describes, requests or clearly establishes a visible change for Iris now.
- visual_change="contextual" only when a meaningful activity/scene transition makes a change strongly natural, or when an image is requested and the current outfit is genuinely unknown. Use ordinary real-world reasoning; there is NO fixed outfit mapping.
- An image request by itself is NOT a reason to change an already-known outfit.
- For a contextual change, choose a plausible visible state from the actual scene/activity/time and current continuity. Stored user preferences may softly influence a choice among plausible options, but never override the situation and never become a permanent uniform.
- If the latest user message only praises a look/style, learn the preference but do not automatically alter CURRENT_VISUAL_STATE unless the message also establishes a current change.
- Resolve references like "those shorts", "the dress we bought", or equivalents using recent conversation and MEMORY_HINTS. Do not invent a remembered item when the hints do not support it.
- appearance_patch contains only fields that actually change or need initialization. Allowed conceptual fields are outfit, footwear, nails, hair, makeup, accessories, other_details. Values are concise natural-language visual descriptions, not codes.
- clear_appearance_fields contains fields that should genuinely become unknown/not applicable; otherwise leave it empty.
- If is_image_request=true and CURRENT_VISUAL_STATE already has an outfit, preserve it unless the user explicitly changes it or a strong contextual transition requires a change.
- If is_image_request=true and CURRENT_VISUAL_STATE has no outfit, infer one plausible complete outfit from context and mark visual_change="contextual" so the same outfit persists into later photos.

VISUAL PREFERENCE MEMORY:
- visual_preference_updates stores durable USER preferences about how Iris looks: clothing, colors, materials, grooming, nails, hair, makeup, accessories, or visual style.
- Extract a visual preference only when explicitly stated or strongly supported; do not infer it from a single generated outfit alone.
- A preference is about what the USER likes/dislikes ON IRIS, not what the user personally wears.
- fact_key must be a short language-neutral snake_case concept. fact_value should preserve the actual preference meaning in natural language. confidence is 0..1.
- relevant_visual_preferences contains only stored preference facts from the supplied profile that are actually useful for this turn. Never fabricate entries.

Keep the legacy routing fields too:
physicality: none | playful | intimate | explicit
intent: neutral | joke | flirt | romance | erotic | uncertain
safety_level: safe | borderline | explicit

Return JSON with exactly these keys:
physicality, intent, safety_level, is_body_topic, is_romance_topic, is_erotic_topic, confidence, heat_level, intensity_style, continues_intimate_scene, iris_nickname, nickname_confidence, preferred_heat_level, preferred_style, preference_confidence, visual_change, appearance_patch, clear_appearance_fields, visual_preference_updates, relevant_visual_preferences, appearance_confidence`;

function safeJsonExtract(text) {
  if (!text) return null;
  const s = String(text).trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); }
  catch { return null; }
}

function validNullableEnum(value, list) {
  return value === null || (typeof value === 'string' && list.includes(value));
}

function validAppearancePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => item === null || typeof item === 'string');
}

function validVisualPreferences(value) {
  if (!Array.isArray(value) || value.length > 4) return false;
  return value.every((item) => item && typeof item === 'object' &&
    typeof item.fact_key === 'string' &&
    typeof item.fact_value === 'string' &&
    typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1);
}

function validateIntentResult(obj) {
  const okEnum = (v, list) => typeof v === 'string' && list.includes(v);
  const okBool = (v) => typeof v === 'boolean';
  const okNum = (v) => typeof v === 'number' && v >= 0 && v <= 1;
  const okHeat = (v) => Number.isInteger(v) && v >= 0 && v <= 3;
  const okPreferredHeat = (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 3);
  if (!obj || typeof obj !== 'object') return false;
  return okEnum(obj.physicality, ['none', 'playful', 'intimate', 'explicit']) &&
    okEnum(obj.intent, ['neutral', 'joke', 'flirt', 'romance', 'erotic', 'uncertain']) &&
    okEnum(obj.safety_level, ['safe', 'borderline', 'explicit']) &&
    okBool(obj.is_body_topic) && okBool(obj.is_romance_topic) && okBool(obj.is_erotic_topic) && okNum(obj.confidence) &&
    okHeat(obj.heat_level) && okEnum(obj.intensity_style, ['neutral', 'gentle', 'playful', 'sensual', 'rough']) &&
    okBool(obj.continues_intimate_scene) &&
    (obj.iris_nickname === null || typeof obj.iris_nickname === 'string') && okNum(obj.nickname_confidence) &&
    okPreferredHeat(obj.preferred_heat_level) && validNullableEnum(obj.preferred_style, ['gentle', 'playful', 'sensual', 'rough']) && okNum(obj.preference_confidence) &&
    okEnum(obj.visual_change, ['none', 'explicit', 'contextual']) &&
    validAppearancePatch(obj.appearance_patch) &&
    Array.isArray(obj.clear_appearance_fields) && obj.clear_appearance_fields.every((item) => typeof item === 'string') &&
    validVisualPreferences(obj.visual_preference_updates) &&
    Array.isArray(obj.relevant_visual_preferences) && obj.relevant_visual_preferences.every((item) => typeof item === 'string') &&
    okNum(obj.appearance_confidence);
}

function fallbackIntent() {
  return {
    physicality: 'none',
    intent: 'uncertain',
    safety_level: 'safe',
    is_body_topic: false,
    is_romance_topic: false,
    is_erotic_topic: false,
    confidence: 0.2,
    heat_level: 0,
    intensity_style: 'neutral',
    continues_intimate_scene: false,
    iris_nickname: null,
    nickname_confidence: 0,
    preferred_heat_level: null,
    preferred_style: null,
    preference_confidence: 0,
    visual_change: 'none',
    appearance_patch: {},
    clear_appearance_fields: [],
    visual_preference_updates: [],
    relevant_visual_preferences: [],
    appearance_confidence: 0.2,
  };
}

function compactHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().slice(0, 500),
    }))
    .filter((item) => item.content);
}

function compactProfilePreferences(profile = []) {
  return (Array.isArray(profile) ? profile : [])
    .slice(0, 24)
    .map((fact) => ({
      category: String(fact?.category || ''),
      fact_key: String(fact?.fact_key || '').slice(0, 120),
      fact_value: String(fact?.fact_value || '').slice(0, 300),
      confidence: Number(fact?.confidence || 0),
    }));
}

function compactMemoryHints(hints = []) {
  return (Array.isArray(hints) ? hints : [])
    .map((item) => String(item || '').trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 6);
}

function previousHeat(sceneContext = {}) {
  const match = String(sceneContext?.interaction_mode || '').match(/^heat_([123])$/);
  return match ? Number(match[1]) : 0;
}

export async function intentJudgeLLM({
  text,
  sceneContext = {},
  conversationHistory = [],
  currentVisualState = null,
  visualPreferenceFacts = [],
  memoryHints = [],
  isImageRequest = false,
}) {
  const client = getLLMClient('openai');
  const model = MODELS.openaiUtility || MODELS.openai;
  const contextHint = {
    last_engine: sceneContext?.last_engine ?? null,
    previous_heat_level: previousHeat(sceneContext),
    last_subject: sceneContext?.last_subject ?? null,
    scene: {
      city: sceneContext?.location_city || sceneContext?._resolved?.city || null,
      country: sceneContext?.location_country || sceneContext?._resolved?.country || null,
      place: sceneContext?.place || null,
      room: sceneContext?.room || null,
      time_of_day: sceneContext?.time_of_day || null,
    },
    is_image_request: Boolean(isImageRequest),
    CURRENT_VISUAL_STATE: currentVisualState?.state || {},
    STORED_PREFERENCE_FACTS: compactProfilePreferences(visualPreferenceFacts),
    MEMORY_HINTS: compactMemoryHints(memoryHints),
  };

  const r = await client.responses.create({
    model,
    reasoning: { effort: 'none' },
    max_output_tokens: 700,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...compactHistory(conversationHistory),
      { role: 'user', content: `Latest user message:\n${String(text)}\n\nContext hint:\n${JSON.stringify(contextHint)}` },
    ],
  });

  const parsed = safeJsonExtract(r.output_text || '');
  return validateIntentResult(parsed) ? parsed : fallbackIntent();
}
