import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const SYSTEM_PROMPT = `You are intentJudge for a global chat system. Your ONLY job is to classify the user message intent and physical/romantic intensity for routing and behavior mode selection.

Important:
- The user message can be in ANY language. Classify by meaning, not by language-specific keywords.
- Output MUST be valid JSON only. No markdown, explanations, or extra keys.
- Be conservative: choose the least intense label that still fits.
- Do NOT generate a reply or roleplay.

Definitions:
physicality: none | playful | intimate | explicit
intent: neutral | joke | flirt | romance | erotic | uncertain
safety_level: safe | borderline | explicit

Also set:
- is_body_topic: boolean
- is_romance_topic: boolean
- is_erotic_topic: boolean
- confidence: 0.0 to 1.0

Return JSON with exactly these keys:
physicality, intent, safety_level, is_body_topic, is_romance_topic, is_erotic_topic, confidence`;

function safeJsonExtract(text) {
  if (!text) return null;
  const s = String(text).trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); }
  catch { return null; }
}

function validateIntentResult(obj) {
  const okEnum = (v, list) => typeof v === 'string' && list.includes(v);
  const okBool = (v) => typeof v === 'boolean';
  const okNum = (v) => typeof v === 'number' && v >= 0 && v <= 1;
  if (!obj || typeof obj !== 'object') return false;
  return okEnum(obj.physicality, ['none', 'playful', 'intimate', 'explicit']) &&
    okEnum(obj.intent, ['neutral', 'joke', 'flirt', 'romance', 'erotic', 'uncertain']) &&
    okEnum(obj.safety_level, ['safe', 'borderline', 'explicit']) &&
    okBool(obj.is_body_topic) && okBool(obj.is_romance_topic) && okBool(obj.is_erotic_topic) && okNum(obj.confidence);
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

export async function intentJudgeLLM({ text, sceneContext = {} }) {
  const client = getLLMClient('openai');
  const model = MODELS.openaiUtility || MODELS.openai;
  const contextHint = {
    last_engine: sceneContext?.last_engine ?? null,
    interaction_mode: sceneContext?.interaction_mode ?? null,
    last_subject: sceneContext?.last_subject ?? null,
  };

  const r = await client.responses.create({
    model,
    reasoning: { effort: 'none' },
    max_output_tokens: 180,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `User message:\n${String(text)}\n\nContext hint:\n${JSON.stringify(contextHint)}` },
    ],
  });

  const parsed = safeJsonExtract(r.output_text || '');
  return validateIntentResult(parsed) ? parsed : fallbackIntent();
}
