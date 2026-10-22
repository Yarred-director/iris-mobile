import { classifyTurn } from './turnClassifier.js';

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

// Routing subset of the shared turn classifier, for callers that only need heat.
export async function classifyIntimacyRoute({ text, sceneContext = {}, conversationHistory = [] }) {
  const turn = await classifyTurn({ text, sceneContext, conversationHistory });
  return {
    heat_level: turn.heat_level,
    intensity_style: turn.intensity_style,
    continues_intimate_scene: turn.continues_intimate_scene,
    confidence: turn.confidence,
    signal: turn.heat_signal,
    hard_limit: turn.hard_limit,
    crisis: turn.crisis,
  };
}
