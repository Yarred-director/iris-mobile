// server/memory/contextJudge.js
// Deterministic extractor for explicit context (NO hallucination).

const STOP_CITY_WORDS = new Set([
  'našom', 'naša', 'našej', 'naše', 'naši', 'našom',
  'mojom', 'moja', 'mojej', 'moje', 'moji', 'mojom',
  'tvojom', 'tvoja', 'tvojej', 'tvoje', 'tvoji', 'tvojom',
  'prenajatom', 'prenajatej', 'prenajatom',
  'apartmáne', 'apartmáne,', 'apartmáne.', 'apartmáte', 'apartmáni',
  'hoteli', 'reštaurácii', 'bare', 'klube'
]);

const TIME_WORDS = [
  { re: /\br[aá]no\b|\br[aá]nko\b|\bdobre r[aá]no\b|\bdobr[ée] r[aá]nko\b/i, v: 'morning' },
  { re: /\bpopoludn[ií]\b|\bpoobede\b/i, v: 'afternoon' },
  { re: /\bve(č|c)er\b|\bdobr[ýy] ve(č|c)er\b/i, v: 'evening' },
  { re: /\bnoc\b|\bdobr[úu] noc\b|\bpolnoc\b/i, v: 'night' },
];

const ROOM_WORDS = [
  // apartment declensions/typos tolerant
  { re: /\bapartm[aá]n(e|i|u|om|om?)\b|\bapartm[aá]t(e|e)?\b/i, v: 'apartment' },
  { re: /\bsp[aá]l(n|ň)a\b/i, v: 'bedroom' },
  { re: /\bkuchy(n|ň)a\b/i, v: 'kitchen' },
  { re: /\bob[ýy]va(č|c)ka\b/i, v: 'living_room' },
  { re: /\bk[úu]pe(ľ|l)(n|ň)a\b/i, v: 'bathroom' },
];

function titleCase(s) {
  return s
    .split(' ')
    .filter(Boolean)
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ✅ Strong city capture for Dubai variants anywhere
function captureKnownCity(text) {
  const t = text.toLowerCase();
  if (/\bdubaj\b|\bdubaji\b|\bdubai\b/.test(t)) return 'Dubaj';
  return null;
}

// ✅ Conservative "sme v X" but ignores stopwords
function captureCityFromV(text) {
  const m = text.match(/\b(?:sme|som|nach[aá]dzame\s+sa|nach[aá]dzam\s+sa)\s+v\s+([A-Za-zÀ-ž'-]{2,})/i);
  if (!m) return null;

  const raw = (m[1] || '').trim();
  if (!raw) return null;

  const lw = raw.toLowerCase();
  if (STOP_CITY_WORDS.has(lw)) return null;

  // Avoid capturing generic nouns
  if (['apartmáne','apartmáni','apartmáte','hoteli','meste','centre','reštaurácii'].includes(lw)) return null;

  return titleCase(raw);
}

// ✅ Proper place after "na", stops at punctuation/end
function capturePlaceAfterNa(text) {
  const m = text.match(
    /\bna\s+([A-ZÁČĎÉÍĽŇÓÔŔŠŤÚÝŽ][A-Za-zÀ-ž'.-]{1,}(?:\s+[A-Za-zÀ-ž'.-]{1,}){0,5})(?=[,.;!?]|$)/u
  );
  if (!m) return null;

  const place = m[1].trim();
  if (place.length < 4) return null;
  return place;
}

export function extractContextFromText({ text, sceneContext }) {
  const t = (text || '').trim();
  if (!t) return null;

  const ctx = sceneContext || {};
  const patch = {};

  // CITY (prefer known city)
  if (!ctx.location_city && !ctx.city) {
    const known = captureKnownCity(t);
    if (known) patch.location_city = known;
    else {
      const city = captureCityFromV(t);
      if (city) patch.location_city = city;
    }
  }

  // PLACE
  if (!ctx.place) {
    const place = capturePlaceAfterNa(t);
    if (place) patch.place = place;
  }

  // ROOM
  if (!ctx.room) {
    for (const r of ROOM_WORDS) {
      if (r.re.test(t)) {
        patch.room = r.v;
        break;
      }
    }
  }

  // TIME (only if missing)
  if (!ctx.time_of_day) {
    for (const td of TIME_WORDS) {
      if (td.re.test(t)) {
        patch.time_of_day = td.v;
        break;
      }
    }
  }

  return Object.keys(patch).length ? patch : null;
}
