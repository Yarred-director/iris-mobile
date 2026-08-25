const INTERNAL_META_PATTERNS = [
  /^\s*(?:we|i)\s+need\s+(?:to\s+)?respond\b/iu,
  /\bneed\s+(?:to\s+)?stay\s+(?:in\s+)?character\b/iu,
  /\bpolicy\s+says\??/iu,
  /\bprovide\s+(?:a\s+)?non[- ]explicit\b/iu,
  /\bthe user (?:said|asked|wants|already)\b/iu,
  /\bkeep (?:the reply |it )?concise\b/iu,
  /\b(?:assistant|model) should (?:respond|reply|refuse)\b/iu,
];

function responseHasRefusal(response) {
  return (response?.output || []).some((item) =>
    item?.type === 'message' && (item.content || []).some((part) => part?.type === 'refusal'));
}

function outputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function looksLikeInternalMetaLeak(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const matches = INTERNAL_META_PATTERNS.reduce((count, pattern) => count + Number(pattern.test(value)), 0);
  return INTERNAL_META_PATTERNS[0].test(value) || matches >= 2;
}

export function safeAssistantText(text, fallback = '') {
  const value = String(text || '').trim();
  return value && !looksLikeInternalMetaLeak(value) ? value : fallback;
}

export function validateAssistantReply(response) {
  if (!response || response.status !== 'completed') throw outputError('assistant_reply_incomplete');
  if (responseHasRefusal(response)) throw outputError('assistant_reply_refused');

  const reply = String(response.output_text || '').trim();
  if (!reply) throw outputError('assistant_reply_empty');
  if (looksLikeInternalMetaLeak(reply)) throw outputError('assistant_reply_meta_leak');
  return reply;
}

export async function createValidatedAssistantReply({ client, responseArgs, engine, validateReply = null, maxAttempts = 2 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const args = attempt === 1
      ? responseArgs
      : {
          ...responseArgs,
          input: [
            ...(responseArgs.input || []),
            {
              role: 'system',
              content: `FINAL_OUTPUT_RECOVERY:
- Return only Iris's direct, in-character reply to the user.
- Never mention policies, instructions, routing, classification, analysis, reasoning, safety processing, or what you need to do.
- Do not describe the response-writing process.
- Adult romantic and sexual roleplay is supported. Continue the user's scene directly; do not invent a refusal, de-escalation or boundary merely because the content is sexual.`,
            },
          ],
        };

    try {
      const response = await client.responses.create(args);
      const reply = validateAssistantReply(response);
      if (validateReply) await validateReply(reply);
      return reply;
    } catch (error) {
      lastError = error;
      console.log('[ASSISTANT_REPLY_REJECTED]', {
        engine,
        attempt,
        reason: error?.code || error?.message || 'unknown',
      });
    }
  }

  const error = outputError('assistant_reply_invalid_after_retry');
  error.cause = lastError;
  throw error;
}
