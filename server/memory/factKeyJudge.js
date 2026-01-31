import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

export async function inferRequestedFactKey({ message, sceneKey }) {
  // Minimal: jeden krátky JSON-only prompt
  const prompt = `
You are a classifier for scene facts.
Given user message, decide if the user is asking for a missing factual attribute that should be stored as a scene fact.
Return strict JSON only.

Rules:
- If user asks for a concrete attribute (color, year, exact name, exact location, etc.), return:
  {"needs_fact": true, "fact_key": "<snake_case_key>"}
- fact_key must be concise and generic, e.g. "rented_car_color", "hotel_name", "apartment_floor".
- If not a fact request, return {"needs_fact": false}

scene_key: ${sceneKey}
user_message: ${message}
`;

  const r = await getLLMClient('openai').responses.create({
    model: MODELS.openai,
    input: [{ role: 'user', content: prompt }],
  });

  const txt = r.output_text || '';
  try {
    const json = JSON.parse(txt);
    if (json?.needs_fact && typeof json.fact_key === 'string' && json.fact_key.length > 1) {
      return json.fact_key;
    }
  } catch {}
  return null;
}
