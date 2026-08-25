const SCOPE_SYSTEM_PROMPT = `You classify how an adult companion-app photo request should use recent conversation context.

Classify the LATEST USER MESSAGE together with only the immediate preceding turns.

request_scope:
- scene_continuation: the latest message explicitly requests this/that/same scene or photo, describes an action/pose/outfit/location to depict, corrects a planned image, or directly accepts a specific image scene proposed in the immediately preceding assistant turn.
- standalone: the latest message is a generic request for a photo/selfie of Iris and the immediately preceding assistant turn does not contain a specific proposed image scene. An error message is not a proposed scene. Do not inherit an older intimate scene through one or more generation errors.

sexualized:
- true when the requested image itself includes nudity, erotic exposure, sexual touching, a sexual act, sexualized posing, or an inherited immediate scene with such content.
- false for an ordinary portrait, selfie, outfit photo, swimwear/fashion photo, or other nonsexual personal photo.

This is classification only. Never answer the user or compose an image prompt. Output only the required structured result.`;

export const IMAGE_REQUEST_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    request_scope: { type: 'string', enum: ['standalone', 'scene_continuation'] },
    sexualized: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    signal: {
      type: 'string',
      enum: ['generic_photo', 'explicit_scene_reference', 'specified_scene', 'accepted_immediate_scene', 'correction'],
    },
  },
  required: ['request_scope', 'sexualized', 'confidence', 'signal'],
};

function scopeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function hasRefusal(response) {
  return (response?.output || []).some((item) =>
    item?.type === 'message' && (item.content || []).some((part) => part?.type === 'refusal'));
}

export function parseImageRequestScopeResponse(response) {
  if (!response || response.status !== 'completed') throw scopeError('image_scope_incomplete');
  if (hasRefusal(response)) throw scopeError('image_scope_refused');

  let value = null;
  try { value = JSON.parse(String(response.output_text || '')); }
  catch { throw scopeError('image_scope_invalid_json'); }

  const valid = value && typeof value === 'object' &&
    ['standalone', 'scene_continuation'].includes(value.request_scope) &&
    typeof value.sexualized === 'boolean' &&
    typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1 &&
    ['generic_photo', 'explicit_scene_reference', 'specified_scene', 'accepted_immediate_scene', 'correction'].includes(value.signal);
  if (!valid) throw scopeError('image_scope_invalid_shape');
  return value;
}

function compactImmediateHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-4)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().slice(0, 600),
    }))
    .filter((item) => item.content);
}

export async function classifyImageRequestScope({ text, conversationHistory = [], llmClient, model }) {
  const response = await llmClient.responses.create({
    model,
    reasoning: { effort: 'none' },
    max_output_tokens: 250,
    text: {
      format: {
        type: 'json_schema',
        name: 'iris_image_request_scope',
        strict: true,
        schema: IMAGE_REQUEST_SCOPE_SCHEMA,
      },
    },
    input: [
      { role: 'system', content: SCOPE_SYSTEM_PROMPT },
      ...compactImmediateHistory(conversationHistory),
      { role: 'user', content: `LATEST USER MESSAGE:\n${String(text || '').trim()}` },
    ],
  });
  return parseImageRequestScopeResponse(response);
}
