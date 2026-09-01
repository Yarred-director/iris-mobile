// Shared response validation; deliberately independent of prompt construction.
export function cognitionError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}

export function parseCompletedJson(response) {
  if (response?.incomplete_details?.reason === 'content_filter') throw cognitionError('cognition_refused');
  if ((response?.output || []).some((item) => (item.content || []).some((part) => part.type === 'refusal'))) {
    throw cognitionError('cognition_refused');
  }
  if (response?.status !== 'completed') {
    throw cognitionError('cognition_incomplete', response?.incomplete_details?.reason === 'max_output_tokens');
  }
  try {
    const parsed = JSON.parse(String(response.output_text || '').replace(/```json|```/g, '').trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw cognitionError('cognition_invalid_json', true); }
}
