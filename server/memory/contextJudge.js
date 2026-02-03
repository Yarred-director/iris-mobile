// server/memory/contextJudge.js
export function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString();
  const t = raw.toLowerCase();

  // --- CITY (strong: Dubai variants anywhere) ---
  if (/\bdubaj\b|\bdubaji\b|\bdubai\b/i.test(t)) {
    // only set if empty or obviously wrong
    if (!sceneContext?.location_city || sceneContext.location_city.toLowerCase() !== 'dubaj') {
      patch.location_city = 'Dubaj';
    }
  }

  // --- PLACE ("na X" until punctuation) ---
  if (!sceneContext?.place) {
    const m = raw.match(/\bna\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[1]) {
      const place = m[1].trim();
      // avoid very short or generic captures
      if (place.length >= 4) patch.place = place;
    }
  }

  // --- ROOM ---
  if (!sceneContext?.room) {
    if (/\bapartm[aá]n|\bapartm[aá]ne|\bapartm[aá]te/i.test(t)) patch.room = 'apartment';
    else if (/\bposte[lľ]/i.test(t)) patch.room = 'bedroom';
    else if (/\bkuchy[nň]/i.test(t)) patch.room = 'kitchen';
  }

  // --- TIME OF DAY (always allowed to update on explicit signal) ---
  if (/\bje\s+r[aá]no\b|\bdobr[eé]\s+r[aá]no\b|\br[aá]nko\b/i.test(t)) {
    patch.time_of_day = 'morning';
  } else if (/\bje\s+ve[cč]er\b|\bdobr[ýy]\s+ve[cč]er\b/i.test(t)) {
    patch.time_of_day = 'evening';
  } else if (/\bnoc\b|\bpolnoc\b/i.test(t)) {
    patch.time_of_day = 'night';
  }

  return Object.keys(patch).length ? patch : null;
}
