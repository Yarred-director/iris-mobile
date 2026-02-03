// server/memory/contextJudge.js
// Deterministic extractor for explicit context (NO hallucination).

const TIME_WORDS = [
  { re: /\br[aá]no\b|\bdobre r[aá]no\b/i, v: 'morning' },
  { re: /\bpopoludn[ií]\b|\bpoobede\b/i, v: 'afternoon' },
  { re: /\bve(č|c)er\b|\bdobr[ýy] ve(č|c)er\b/i, v: 'evening' },
  { re: /\bnoc\b|\bdobr[úu] noc\b/i, v: 'night' },
];

const ROOM_WORDS = [
  { re: /\bapartm[aá]n\b/i, v: 'apartment' },
  { re: /\bsp[aá]l(n|ň)a\b/i, v: 'bedroom' },
  { re: /\bkuchy(n|ň)a\b/i, v: 'kitchen' },
];

function titleCase(s) {
  return s.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

// "sme v Dubaji"
function captureCity(text) {
  const m = text.match(/\b(?:sme|som)\s+v\s+([A-Za-zÀ-ž]+)/i);
  if (!m) return null;
  return titleCase(m[1]);
}

// "na Jumeirah Beach"
function capturePlace(text) {
  const m = text.match(/\bna\s+([A-ZÁČĎÉÍĽŇÓÔŔŠŤÚÝŽ][A-Za-zÀ-ž\s]{2,40})/u);
  if (!m) return null;
  return m[1].trim();
}

export function extractContextFromText({ text, sceneContext }) {
  const t = (text || '').trim();
  if (!t) return null;

  const ctx = sceneContext || {};
  const patch = {};

  // CITY
  if (!ctx.location_city && !ctx.city) {
    const city = captureCity(t);
    if (city) patch.location_city = city;
  }

  // PLACE
  if (!ctx.place) {
    const place = capturePlace(t);
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
