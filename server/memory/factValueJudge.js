import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

export async function extractFactValue({ factKey, userMessage }) {
  const prompt = `
Extract a value for the requested fact from the user's message.
Return strict JSON only: {"value": "<string>", "confidence": 0..1}
If the message does not contain a clear value, return {"value": null, "confidence": 0}

fact_key: ${factKey}
user_message: ${userMessage}
`;

  const r = await getLLMClient('openai').responses.create({
    model: MODELS.openai,
    input: [{ role: 'user', content: prompt }],
  });

  const txt = r.output_text || '';
  try {
    const json = JSON.parse(txt);
    if (typeof json?.value === 'string' && json.value.trim().length > 0) {
      return { value: json.value.trim(), confidence: Math.max(0, Math.min(1, Number(json.confidence ?? 0.8))) };
    }
  } catch {}
  return { value: null, confidence: 0 };
}
