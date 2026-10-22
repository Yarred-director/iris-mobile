// One strict-schema semantic classification per user turn. It replaces language-specific
// keyword gates: every routing/memory/safety decision works the same in any language.
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const SYSTEM_PROMPT = `You are the turn classifier of a global adult companion application.
Classify ONLY the latest user message (use prior turns as context). Never answer or roleplay.
Interpret meaning in any language or script; never rely on keywords of one language.

heat_level (provider routing label, not a content limit):
0 = normal conversation, friendship, jokes, non-physical flirting.
1 = soft romance: affectionate flirting, hugs, cuddling, gentle kisses, non-sexual caresses.
2 = sensual/foreplay: sexualized touching of thighs, hips, butt or breasts, grinding, sensual undressing, clear arousal.
3 = explicit sexual activity: genital touching, masturbation, oral sex, penetration, orgasm-focused action.
Kiss plus grabbing butt/thigh/breast is 2. Heat 3 can be gentle; roughness is intensity_style.
A short continuation ("yes", "continue", an emoji or equivalent) preserves PREVIOUS HEAT LEVEL when context shows an active intimate scene.

Other fields:
- language: ISO 639-1 code of the latest substantive user message; if language-neutral, the recent conversation language.
- wants_companion_image: the user asks to receive a photo/picture/selfie of the companion or of a named AI person. Talking about screens, photography as a job, or generating non-image things is false.
- needs_live_lookup: answering needs current real-world information (places, prices, opening hours, news, weather) or reading a link.
- is_factual_question: the user asks for a real-world fact that must not be invented.
- scene_update: only values the latest message establishes for the shared roleplay/real setting; otherwise null. time_of_day is morning|afternoon|evening|night or null.
- memory: worth_remembering = durable fact, preference, plan, milestone or distinctive shared moment; emotional = meaningful emotional content; preference = the user states a durable like/dislike.
- persona_signal: the user shapes the companion (name, personality, appearance, interests, role, how to address the user) or tells durable facts about who they are.
- crisis: urgent = imminent danger to self/others; concern = distress suggesting possible self-harm; otherwise none. Roleplay drama is not a crisis.
- hard_limit: minor_sexual = sexual content involving a minor or someone described as underage/childlike; real_person_sexual = sexual content about a real identifiable person; otherwise none. Adult fiction is not a hard limit.
Output only the schema.`;

const NULLABLE_TEXT = { type: ['string', 'null'], maxLength: 120 };

export const TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', maxLength: 12 },
    heat_level: { type: 'integer', enum: [0, 1, 2, 3] },
    intensity_style: { type: 'string', enum: ['neutral', 'gentle', 'playful', 'sensual', 'rough'] },
    continues_intimate_scene: { type: 'boolean' },
    heat_signal: { type: 'string', enum: ['normal', 'soft_romance', 'sensual', 'explicit', 'continuation'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    wants_companion_image: { type: 'boolean' },
    needs_live_lookup: { type: 'boolean' },
    is_factual_question: { type: 'boolean' },
    scene_update: {
      type: 'object',
      additionalProperties: false,
      properties: {
        place: NULLABLE_TEXT,
        room: NULLABLE_TEXT,
        location_city: NULLABLE_TEXT,
        location_country: NULLABLE_TEXT,
        time_of_day: { type: ['string', 'null'], enum: ['morning', 'afternoon', 'evening', 'night', null] },
      },
      required: ['place', 'room', 'location_city', 'location_country', 'time_of_day'],
    },
    memory: {
      type: 'object',
      additionalProperties: false,
      properties: {
        worth_remembering: { type: 'boolean' },
        emotional: { type: 'boolean' },
        preference: { type: 'boolean' },
      },
      required: ['worth_remembering', 'emotional', 'preference'],
    },
    persona_signal: { type: 'boolean' },
    crisis: { type: 'string', enum: ['none', 'concern', 'urgent'] },
    hard_limit: { type: 'string', enum: ['none', 'minor_sexual', 'real_person_sexual'] },
  },
  required: [
    'language', 'heat_level', 'intensity_style', 'continues_intimate_scene', 'heat_signal', 'confidence',
    'wants_companion_image', 'needs_live_lookup', 'is_factual_question', 'scene_update', 'memory',
    'persona_signal', 'crisis', 'hard_limit',
  ],
};

function classifierError(code) {
  return Object.assign(new Error(code), { code });
}

function hasRefusal(response) {
  return (response?.output || []).some((item) =>
    item?.type === 'message' && (item.content || []).some((part) => part?.type === 'refusal'));
}

const ENUMS = {
  intensity_style: ['neutral', 'gentle', 'playful', 'sensual', 'rough'],
  heat_signal: ['normal', 'soft_romance', 'sensual', 'explicit', 'continuation'],
  crisis: ['none', 'concern', 'urgent'],
  hard_limit: ['none', 'minor_sexual', 'real_person_sexual'],
};

function isValidTurn(value) {
  if (!value || typeof value !== 'object') return false;
  const bool = (key) => typeof value[key] === 'boolean';
  const scene = value.scene_update;
  const memory = value.memory;
  return typeof value.language === 'string'
    && Number.isInteger(value.heat_level) && value.heat_level >= 0 && value.heat_level <= 3
    && Object.entries(ENUMS).every(([key, list]) => list.includes(value[key]))
    && typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1
    && ['continues_intimate_scene', 'wants_companion_image', 'needs_live_lookup', 'is_factual_question', 'persona_signal'].every(bool)
    && scene && typeof scene === 'object'
    && ['place', 'room', 'location_city', 'location_country', 'time_of_day'].every((key) => scene[key] === null || typeof scene[key] === 'string')
    && memory && ['worth_remembering', 'emotional', 'preference'].every((key) => typeof memory[key] === 'boolean');
}

export function parseTurnClassification(response) {
  if (!response || response.status !== 'completed') throw classifierError('intimacy_route_incomplete');
  if (hasRefusal(response)) throw classifierError('intimacy_route_refused');
  let parsed = null;
  try { parsed = JSON.parse(String(response.output_text || '')); }
  catch { throw classifierError('intimacy_route_invalid_json'); }
  if (!isValidTurn(parsed)) throw classifierError('intimacy_route_invalid_shape');
  // A hard-limit or crisis turn is never routed as an intimate continuation.
  if (parsed.hard_limit !== 'none' || parsed.crisis === 'urgent') {
    parsed.continues_intimate_scene = false;
  }
  parsed.language = parsed.language.trim().toLowerCase().slice(0, 12) || null;
  return parsed;
}

function compactHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().slice(0, 500),
    }))
    .filter((item) => item.content);
}

function previousHeat(sceneContext = {}) {
  const match = String(sceneContext?.interaction_mode || '').match(/^heat_([123])$/);
  return match ? Number(match[1]) : 0;
}

export async function classifyTurn({ text, sceneContext = {}, conversationHistory = [], attachmentCount = 0, llmClient = null }) {
  const client = llmClient || getLLMClient('openai');
  const response = await client.responses.create({
    model: MODELS.openaiUtility || MODELS.openai,
    reasoning: { effort: 'none' },
    max_output_tokens: 400,
    text: { format: { type: 'json_schema', name: 'companion_turn', strict: true, schema: TURN_SCHEMA } },
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...compactHistory(conversationHistory),
      {
        role: 'user',
        content: `LATEST USER MESSAGE:\n${String(text || '')}\n\nATTACHED IMAGES: ${Number(attachmentCount) || 0}\nPREVIOUS HEAT LEVEL: ${previousHeat(sceneContext)}`,
      },
    ],
  });
  return parseTurnClassification(response);
}

export function sceneUpdatePatch(turn) {
  const patch = {};
  for (const [key, value] of Object.entries(turn?.scene_update || {})) {
    if (typeof value === 'string' && value.trim()) patch[key] = value.trim();
  }
  return patch;
}

export function buildSafetyDirective(turn) {
  const lines = [];
  if (turn?.crisis === 'urgent' || turn?.crisis === 'concern') {
    lines.push('RUNTIME_CRISIS_CONTROL: The user may be in distress or danger. Apply the PLATFORM CRISIS rule now: set roleplay and intimacy aside, answer with direct warmth in their language, and gently encourage contacting local emergency services or a crisis line in their country.');
  }
  if (turn?.hard_limit && turn.hard_limit !== 'none') {
    lines.push('RUNTIME_HARD_LIMIT: The latest request crosses a PLATFORM HARD LIMIT. Decline that part briefly and in character, then offer to continue another way.');
  }
  return lines.join('\n');
}
