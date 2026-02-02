// server/memory/contextJudge.js
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const SYSTEM = `
You are an information extractor for a chat app.
Extract ONLY facts explicitly stated by the user (no guessing).
Return STRICT JSON only, no markdown, no extra text.

Schema:
{
  "explicit": boolean,
  "confidence": number,
  "location_city": string | null,
  "location_country": string | null,
  "time_of_day": "morning" | "afternoon" | "evening" | "night" | null,
  "room": string | null,
  "reason": string
}

Rules:
- If user says "we are in <city>" / "sme v <mesto>", that is explicit.
- If user does NOT mention location/time/room, set them null and explicit=false.
- If ambiguous ("here", "in the city"), set explicit=false.
- Do NOT infer missing country from city unless user explicitly states it.
- Do NOT infer time_of_day unless user explicitly says it.
- Output must be valid JSON only.
`.trim();

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export async function extractContextFromText(text) {
  const client = getLLMClient('openai');

  const r = await client.responses.create({
    model: MODELS.openai,
    input: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text || '' }
    ]
  });

  const raw = (r.output_text || '').trim();
  const parsed = safeJsonParse(raw);

  if (!parsed || typeof parsed !== 'object') {
    return {
      explicit: false,
      confidence: 0,
      location_city: null,
      location_country: null,
      time_of_day: null,
      room: null,
      reason: 'parse_failed'
    };
  }

  const out = {
    explicit: !!parsed.explicit,
    confidence: clamp01(parsed.confidence),
    location_city: parsed.location_city ?? null,
    location_country: parsed.location_country ?? null,
    time_of_day: parsed.time_of_day ?? null,
    room: parsed.room ?? null,
    reason: String(parsed.reason ?? '')
  };

  if (!['morning', 'afternoon', 'evening', 'night', null].includes(out.time_of_day)) {
    out.time_of_day = null;
  }

  return out;
}
