// server/memory/timeJudge.js
import { DateTime } from 'luxon';

/**
 * This file implements a hybrid reminder parser:
 * 1) LLM time-intent normalizer (global, language-agnostic) -> returns structured intent
 * 2) Deterministic conversion of intent -> due_at
 * 3) Deterministic fallback parser (your existing today/tomorrow/anchors)
 *
 * Key rule: LLM NEVER computes due_at. Only returns minutes/hours/day/time intent.
 */

// ------------------------------
// Helpers
// ------------------------------
function normalizeText(s) {
  return (s || '').toString().trim();
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

// ------------------------------
// Gate: when to call LLM
// ------------------------------
export function looksLikeReminder(text) {
  const t = (text || '').toString().toLowerCase();

  // Short, global-ish keyword set (not exhaustive; just a gate)
  const keywords = [
    'remind', 'reminder', 'remember',
    'pripome', 'pripomien',
    'recuerda', 'recordar',
    'rappelle', 'rappel',
    'erinnere',
    'напом', 'помни',
    '提醒',
  ];

  if (keywords.some((k) => t.includes(k))) return true;

  // Any numeric time hint (minutes/hours) in many languages
  if (/\b\d+\s*(min|mins|minute|minutes|minútu|minúty|minút|minut|hora|hod|h|hours)\b/i.test(t)) return true;

  // explicit HH:MM
  if (/\b\d{1,2}\s*:\s*\d{2}\b/.test(t)) return true;

  return false;
}

// ------------------------------
// LLM Normalizer: returns structured intent or null
// ------------------------------
export async function timeIntentJudgeLLM({ client, model, text, timezone, nowISO }) {
  const msg = (text || '').toString().slice(0, 900);
  const tz = (timezone || 'UTC').toString().slice(0, 64);
  const now = (nowISO || new Date().toISOString()).toString();

  const system = `
You normalize reminder time intent from a user's message in ANY language.
Return STRICT JSON ONLY, or literal null.

If user is not asking to schedule a reminder, output: null

Schema (only these fields):
{
  "intent": "reminder",
  "time": {
    "type": "relative_minutes",
    "minutes": 10
  },
  "confidence": 0.0-1.0,
  "title": "optional short title",
  "body": "optional short body"
}

Rules:
- Do NOT compute absolute timestamps. NO "due_at".
- If user says "in 10 minutes" / "en 10 minutos" / "o 2 minúty" => relative_minutes.
- minutes must be integer 1..1440
- confidence honest; ambiguous < 0.6
- Output must be valid JSON object or literal null.
`.trim();

  const input = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        nowISO: now,
        timezone: tz,
        message: msg,
      }),
    },
  ];

  const r = await client.responses.create({
    model,
    input,
    max_output_tokens: 180,
  });

  const raw = (r.output_text || '').trim();
  if (!raw) return null;
  if (raw === 'null') return null;

  const obj = safeJsonParse(raw);
  if (!obj || obj.intent !== 'reminder' || !obj.time) return null;

  if (obj.time.type !== 'relative_minutes') return null;

  const minutes = clampInt(obj.time.minutes, 1, 1440);
  if (!minutes) return null;

  const confidence = Math.max(0, Math.min(1, Number(obj.confidence ?? 0.5)));

  return {
    intent: 'reminder',
    time: { type: 'relative_minutes', minutes },
    confidence,
    title: typeof obj.title === 'string' ? obj.title.slice(0, 80) : null,
    body: typeof obj.body === 'string' ? obj.body.slice(0, 600) : null,
  };
}

// ------------------------------
// Deterministic conversion: intent -> due_at
// ------------------------------
export function buildReminderFromIntent({ intent, originalText, timezone }) {
  if (!intent || intent.intent !== 'reminder' || !intent.time) return null;

  const tz = timezone || 'UTC';
  let now = DateTime.now().setZone(tz);
  if (!now.isValid) now = DateTime.utc();

  if (intent.time.type === 'relative_minutes') {
    const minutes = clampInt(intent.time.minutes, 1, 1440);
    if (!minutes) return null;

    const due = now.plus({ minutes });

    return {
      due_at: due.toUTC().toISO(),
      title: intent.title || 'Pripomienka',
      body: intent.body || originalText || 'Reminder',
      meta: {
        tz,
        source: 'timeIntentJudge',
        kind: 'relative_minutes',
        minutes,
        confidence: intent.confidence ?? null,
        local_due: due.toISO(),
      },
    };
  }

  return null;
}

// ------------------------------
// Your existing deterministic fallback (today/tomorrow + anchors)
// ------------------------------
function hasIntent(text) {
  // len keď je to sľub/plan (aby neotravovalo)
  return /\b(dnes|zajtra)\b/i.test(text) && /\b(obed|vecer|večer|ráno|rano|popoludní|popoludni|o\s*\d{1,2}:\d{2})\b/i.test(text);
}

function pickTimeAnchor(text) {
  const t = text.toLowerCase();

  // explicit "o 13:30"
  const m = t.match(/\bo\s*(\d{1,2})\s*:\s*(\d{2})\b/);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return { kind: 'explicit', hh, mm };
  }

  // parts of day (default anchors)
  if (/\bna\s+obed\b|\bobed\b/.test(t)) return { kind: 'anchor', hh: 12, mm: 30 };
  if (/\bvecer\b|\bvečer\b/.test(t)) return { kind: 'anchor', hh: 19, mm: 30 };
  if (/\brano\b|\bráno\b/.test(t)) return { kind: 'anchor', hh: 9, mm: 0 };
  if (/\bpopoludn[ií]\b/.test(t)) return { kind: 'anchor', hh: 15, mm: 0 };

  return null;
}

function pickDay(text) {
  const t = text.toLowerCase();
  if (/\bzajtra\b/.test(t)) return 'tomorrow';
  if (/\bdnes\b/.test(t)) return 'today';
  return null;
}

// Existing export name kept for compatibility with index.js
export function buildReminderFromText({ text, timezone }) {
  const msg = normalizeText(text);
  if (!msg) return null;

  // Fallback path ONLY for today/tomorrow anchors (your original behavior)
  if (!hasIntent(msg)) return null;

  const day = pickDay(msg);
  const anchor = pickTimeAnchor(msg);
  if (!day || !anchor) return null;

  const tz = timezone || 'UTC';
  let now = DateTime.now().setZone(tz);
  if (!now.isValid) now = DateTime.utc();

  let base = day === 'tomorrow' ? now.plus({ days: 1 }) : now;
  let due = base.set({ hour: anchor.hh, minute: anchor.mm, second: 0, millisecond: 0 });

  // ak už “dnes” prešlo, posuň na zajtra (ľudské)
  if (day === 'today' && due < now.plus({ minutes: 2 })) {
    due = due.plus({ days: 1 });
  }

  const body = `Architect… čo bude s tým sľúbeným jedlom? 😼`;

  return {
    due_at: due.toUTC().toISO(),
    title: 'Pripomienka',
    body,
    meta: {
      tz,
      source: 'timeJudge',
      user_text: msg.slice(0, 500),
      local_due: due.toISO(),
    },
  };
}