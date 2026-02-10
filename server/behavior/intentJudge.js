import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

// Multilingual, robust intent classifier.
// Returns STRICT JSON (best-effort) and safe fallback if parsing fails.

const SYSTEM_PROMPT = `You are intentJudge for a global chat system. Your ONLY job is to classify the user message intent and physical/romantic intensity for routing and behavior mode selection.

Important:
- The user message can be in ANY language (English, Slovak, Czech, Spanish, Arabic, Hindi, Japanese, etc.). Classify by meaning, not by specific keywords in one language.
- Output MUST be valid JSON only. No markdown, no explanations, no extra keys.

Rules:
- Be conservative: choose the least intense label that still fits.
- Distinguish playful social humor from intimate/erotic intent even if similar body-related words appear.
- If ambiguous, choose "uncertain" and use lower confidence.
- Do NOT generate a reply. Do NOT roleplay. Do NOT add commentary.

Definitions:
physicality:
- "none": no physical contact implied
- "playful": light, jokey, social touch (not escalating)
- "intimate": sensual/romantic closeness, escalating tension but not explicit sex
- "explicit": explicit sexual actions, genitals, undressing with sexual intent, direct sexual commands

intent:
- "neutral": no romance/sexuality
- "joke": humor/banter, not escalation
- "flirt": romantic teasing, mild suggestive vibe
- "romance": affectionate, tender intimacy without explicit sex
- "erotic": explicit or strongly sexually escalating content
- "uncertain": cannot reliably determine

safety_level:
- "safe": neutral/joke/flirt/romance without explicit sex
- "borderline": sensual escalation or ambiguous sexual intent
- "explicit": explicit sexual content

Also set:
- is_body_topic: true if body/sensations/touch are materially present (even playful)
- is_romance_topic: true if romantic/affectionate intent is present
- is_erotic_topic: true if sexual intent is present
- confidence: 0.0 to 1.0

Return JSON with exactly these keys:
physicality, intent, safety_level, is_body_topic, is_romance_topic, is_erotic_topic, confidence

Guidance examples (do not output these):
1) "I slap your butt jokingly and laugh" -> physicality:"playful", intent:"joke", safety_level:"safe"
2) "I pull you close and kiss your neck" -> physicality:"intimate", intent:"romance", safety_level:"borderline"
3) "Unzip my pants" -> physicality:"explicit", intent:"erotic", safety_level:"explicit"
`;

function safeJsonExtract(text) {
  if (!text) return null;
  const s = String(text).trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function validateIntentResult(obj) {
  const okEnum = (v, list) => typeof v === 'string' && list.includes(v);
  const okBool = (v) => typeof v === 'boolean';
  const okNum = (v) => typeof v === 'number' && v >= 0 && v <= 1;

  if (!obj || typeof obj !== 'object') return false;

  if (
    !okEnum(obj.physicality, ['none', 'playful', 'intimate', 'explicit']) ||
    !okEnum(obj.intent, ['neutral', 'joke', 'flirt', 'romance', 'erotic', 'uncertain']) ||
    !okEnum(obj.safety_level, ['safe', 'borderline', 'explicit']) ||
    !okBool(obj.is_body_topic) ||
    !okBool(obj.is_romance_topic) ||
    !okBool(obj.is_erotic_topic) ||
    !okNum(obj.confidence)
  ) return false;

  return true;
}

function fallbackIntent() {
  return {
    physicality: 'none',
    intent: 'uncertain',
    safety_level: 'safe',
    is_body_topic: false,
    is_romance_topic: false,
    is_erotic_topic: false,
    confidence: 0.2,
  };
}

/**
 * @param {object} args
 * @param {string} args.text - user message
 * @param {object} [args.sceneContext] - optional SCC snapshot for slight disambiguation
 */
export async function intentJudgeLLM({ text, sceneContext = {} }) {
  const client = getLLMClient('openai');
  const model = MODELS.openai;

  const contextHint = {
    last_engine: sceneContext?.last_engine ?? null,
    interaction_mode: sceneContext?.interaction_mode ?? null,
    last_subject: sceneContext?.last_subject ?? null,
  };

  const input = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `User message:\n${String(text)}\n\n` +
        `Context hint (may be null):\n${JSON.stringify(contextHint)}`,
    },
  ];

  const r = await client.responses.create({
    model,
    input,
  });

  const raw = r.output_text || '';
  const parsed = safeJsonExtract(raw);

  if (!validateIntentResult(parsed)) {
    return fallbackIntent();
  }
  return parsed;
}