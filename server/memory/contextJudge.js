// server/memory/contextJudge.js
// Deterministic extractor for explicit context (NO hallucination).
// Captures ONLY what user explicitly says.
// Output: { city?, country?, place?, room?, time_of_day? } | null

const PLACE_WORDS = [
  { re: /\bterasa\b/i, place: "terrace" },
  { re: /\bbalk[oó]n\b/i, place: "balcony" },
  { re: /\bhotel\b/i, place: "hotel" },
  { re: /\bkaviare(n|ň)\b/i, place: "cafe" },
  { re: /\bre[šs]taur[aá]ci(a|i)\b/i, place: "restaurant" },
  { re: /\buli(ca|ke)\b/i, place: "street" },
];

const ROOM_WORDS = [
  { re: /\bsp[aá]l(n|ň)a\b/i, room: "bedroom" },
  { re: /\bkuchy(n|ň)a\b/i, room: "kitchen" },
  { re: /\bob[ýy]va(č|c)ka\b/i, room: "living_room" },
  { re: /\bk[úu]pe(ľ|l)(n|ň)a\b/i, room: "bathroom" },
];

const TIME_WORDS = [
  { re: /\br[aá]no\b|\bdobre r[aá]no\b/i, time_of_day: "morning" },
  { re: /\bdoobeda\b/i, time_of_day: "morning" },
  { re: /\bobed\b/i, time_of_day: "noon" },
  { re: /\bpopoludn[ií]\b|\bpoobede\b/i, time_of_day: "afternoon" },
  { re: /\bve(č|c)er\b|\bdobr[ýy] ve(č|c)er\b/i, time_of_day: "evening" },
  { re: /\bnoc\b|\bdobr[úu] noc\b|\bpolnoc\b/i, time_of_day: "night" },

  // EN fallback
  { re: /\bmorning\b/i, time_of_day: "morning" },
  { re: /\bafternoon\b/i, time_of_day: "afternoon" },
  { re: /\bevening\b/i, time_of_day: "evening" },
  { re: /\bnight\b|\bmidnight\b/i, time_of_day: "night" },
];

// conservative capture after "v" (1–3 tokens, letters/diacritics)
// Handles punctuation after city too.
function captureCity(text) {
  const m = text.match(
    /\b(sme|som|nach[aá]dzame\s+sa|nach[aá]dzam\s+sa)\s+v\s+([A-Za-zÀ-ž'.-]{2,})(?:\s+([A-Za-zÀ-ž'.-]{2,}))?(?:\s+([A-Za-zÀ-ž'.-]{2,}))?(?=[\s,.;!?]|$)/i
  );
  if (!m) return null;

  const raw = [m[2], m[3], m[4]].filter(Boolean).join(" ").trim();
  if (!raw) return null;

  // Title-case-ish, without "correcting" spelling
  return raw
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Optional explicit country capture (ONLY if user literally says it)
// Examples:
// - "sme v Berlíne v Nemecku"
// - "we are in Berlin, Germany"
function captureCountry(text) {
  const m = text.match(
    /\b(v|in)\s+([A-Za-zÀ-ž'.-]{2,})(?:\s+([A-Za-zÀ-ž'.-]{2,}))?(?:\s+([A-Za-zÀ-ž'.-]{2,}))?\b/i
  );
  // Too ambiguous to safely parse without a strict pattern – so we intentionally keep this disabled.
  // We'll do country inference + confirmation later (your plan).
  return null;
}

export function extractContextFromText({ text, sceneContext }) {
  const t = (text || "").trim();
  if (!t) return null;

  const ctx = sceneContext || {};
  const patch = {};

  // City only if SCC doesn't already have it
  if (!ctx.city) {
    const city = captureCity(t);
    if (city) patch.city = city;
  }

  // Place only if missing
  if (!ctx.place) {
    for (const p of PLACE_WORDS) {
      if (p.re.test(t)) {
        patch.place = p.place;
        break;
      }
    }
  }

  // Room only if missing
  if (!ctx.room) {
    for (const r of ROOM_WORDS) {
      if (r.re.test(t)) {
        patch.room = r.room;
        break;
      }
    }
  }

  // time_of_day only if explicitly said, and only if missing
  if (!ctx.time_of_day) {
    for (const td of TIME_WORDS) {
      if (td.re.test(t)) {
        patch.time_of_day = td.time_of_day;
        break;
      }
    }
  }

  // country intentionally NOT extracted here (we'll do confirm-flow tomorrow)
  // const country = captureCountry(t); if (!ctx.country && country) patch.country = country;

  return Object.keys(patch).length ? patch : null;
}
