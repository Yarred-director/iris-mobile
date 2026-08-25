import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const ROUTE_SYSTEM_PROMPT = `You are the dedicated intimacy-routing classifier for Iris, a global adult companion application.

Your only task is to classify the LATEST USER message. Never answer the user and never roleplay.

Rules:
- Interpret meaning in any language or script. Do not depend on English keywords.
- Classify the current behavior accurately. Heat is a provider-routing label, not a response boundary.
- A remembered preference does not change the semantic label of the latest behavior.
- Preserve an active intimate level only for a genuine short continuation such as "yes", "continue", or an equivalent in any language.

Heat levels:
0 = normal conversation, friendship, jokes, or non-physical neutral flirting.
1 = soft romance: affectionate flirting, hugs, cuddling, gentle kissing, or non-sexual caresses.
2 = sensual/foreplay territory: sexualized touching of thighs, hips, butt or breasts; grinding; sensual undressing; clear arousal; sexual making out. This is not explicit sex.
3 = explicit sexual activity: genital touching, masturbation, oral sex, penetration, explicit sex acts, or orgasm-focused action.

Important distinctions:
- Kiss plus grabbing butt/thigh/breast is heat 2, not heat 1 or 3.
- Sensual removal of clothing is heat 2 unless the message already describes an explicit sex act.
- Heat 3 may still be gentle. Roughness is a separate style dimension.
- Output only the required structured result.`;

export const INTIMACY_ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    heat_level: { type: 'integer', enum: [0, 1, 2, 3] },
    intensity_style: { type: 'string', enum: ['neutral', 'gentle', 'playful', 'sensual', 'rough'] },
    continues_intimate_scene: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    signal: { type: 'string', enum: ['normal', 'soft_romance', 'sensual', 'explicit', 'continuation'] },
  },
  required: ['heat_level', 'intensity_style', 'continues_intimate_scene', 'confidence', 'signal'],
};

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

function responseHasRefusal(response) {
  return (response?.output || []).some((item) =>
    item?.type === 'message' && (item.content || []).some((part) => part?.type === 'refusal'));
}

function isValidRoute(value) {
  return !!value && typeof value === 'object' &&
    Number.isInteger(value.heat_level) && value.heat_level >= 0 && value.heat_level <= 3 &&
    ['neutral', 'gentle', 'playful', 'sensual', 'rough'].includes(value.intensity_style) &&
    typeof value.continues_intimate_scene === 'boolean' &&
    typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1 &&
    ['normal', 'soft_romance', 'sensual', 'explicit', 'continuation'].includes(value.signal);
}

function routingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function parseIntimacyRouteResponse(response) {
  if (!response || response.status !== 'completed') throw routingError('intimacy_route_incomplete');
  if (responseHasRefusal(response)) throw routingError('intimacy_route_refused');

  let parsed = null;
  try { parsed = JSON.parse(String(response.output_text || '')); }
  catch { throw routingError('intimacy_route_invalid_json'); }

  if (!isValidRoute(parsed)) throw routingError('intimacy_route_invalid_shape');
  return parsed;
}

export async function classifyIntimacyRoute({ text, sceneContext = {}, conversationHistory = [] }) {
  const client = getLLMClient('openai');
  const response = await client.responses.create({
    model: MODELS.openaiUtility || MODELS.openai,
    reasoning: { effort: 'none' },
    max_output_tokens: 300,
    text: {
      format: {
        type: 'json_schema',
        name: 'iris_intimacy_route',
        strict: true,
        schema: INTIMACY_ROUTE_SCHEMA,
      },
    },
    input: [
      { role: 'system', content: ROUTE_SYSTEM_PROMPT },
      ...compactHistory(conversationHistory),
      {
        role: 'user',
        content: `LATEST USER MESSAGE:\n${String(text || '')}\n\nPREVIOUS HEAT LEVEL: ${previousHeat(sceneContext)}`,
      },
    ],
  });

  return parseIntimacyRouteResponse(response);
}
