// server/memory/factJudge.js
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

export async function factJudge({ text, schema }) {
  const client = getLLMClient('openai');

  const schemaCompact = (schema || []).map(s => ({
    fact_key: s.fact_key,
    value_type: s.value_type,
    allowed_values: s.allowed_values ?? null,
    description: s.description ?? null,
  }));

  const sys = `
You are a strict fact extraction engine.

Return ONLY valid JSON.
Output format: a JSON array:
[
  {"fact_key": "...", "fact_value": <value>, "confidence": 0.0-1.0}
]

Rules:
- Extract ONLY facts explicitly present in USER_TEXT.
- Do NOT infer, guess, or embellish.
- fact_key MUST be from FACT_SCHEMA.
- Respect value_type:
  - text -> string
  - number -> number
  - boolean -> true/false
  - json -> object
  - enum -> MUST be one of allowed_values; otherwise omit
- If nothing is explicit, return [].
`.trim();

  const r = await client.responses.create({
    model: MODELS.openai,
    input: [
      { role: 'system', content: sys },
      { role: 'user', content: `USER_TEXT:\n${text}\n\nFACT_SCHEMA:\n${JSON.stringify(schemaCompact)}` },
    ],
  });

  const out = (r.output_text || '').trim();
  try {
    const arr = JSON.parse(out);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(x => x && typeof x.fact_key === 'string')
      .map(x => ({
        fact_key: x.fact_key,
        fact_value: x.fact_value,
        confidence: typeof x.confidence === 'number' ? x.confidence : 0.9,
      }));
  } catch {
    return [];
  }
}
