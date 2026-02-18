// server/memory/contextJudge.js

export function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString();
  const t = raw.toLowerCase();

  // --- CITY/COUNTRY (explicit STATE only): "sme v X" ---
  // Overwrite allowed ONLY if user explicitly states current location.
  // NOTE: we keep key name location_city as your current schema uses it.
  {
    const m = raw.match(/\bsme\s+v\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[1]) {
      const loc = m[1].trim();
      if (loc.length >= 3 && loc.length <= 60) {
        // allow overwrite (moving between cities is normal)
        patch.location_city = loc;
      }
    }
  }

  // --- PLACE (explicit STATE only): "sme na X" ---
  // Overwrite allowed ONLY if user explicitly states current place.
  {
    // prefer "sme na X"
    let m = raw.match(/\bsme\s+na\s+(.+?)(?=[\.,;!?\n]|$)/i);

    // optional: "teraz sme na X"
    if (!m) m = raw.match(/\bteraz\s+sme\s+na\s+(.+?)(?=[\.,;!?\n]|$)/i);

    if (m && m[1]) {
      const place = m[1].trim();
      if (place.length >= 3 && place.length <= 80) {
        patch.place = place;
      }
    }
  }

  // --- ROOM (explicit STATE) ---
  // Allow overwrite when explicitly mentioned (people move rooms)
  {
    if (/\bapartm[aá]n|\bapartm[aá]ne|\bapartm[aá]te/i.test(t)) patch.room = 'apartment';
    else if (/\bsp[aá]l[nň]a|\bposte[lľ]/i.test(t)) patch.room = 'bedroom';
    else if (/\bkuchy[nň]/i.test(t)) patch.room = 'kitchen';
  }

  // --- TIME OF DAY (explicit only) ---
  // Allow overwrite (time passes)
  if (/\bje\s+r[aá]no\b|\bdobr[eé]\s+r[aá]no\b|\br[aá]nko\b/i.test(t)) patch.time_of_day = 'morning';
  else if (/\bje\s+ve[cč]er\b|\bdobr[ýy]\s+ve[cč]er\b/i.test(t)) patch.time_of_day = 'evening';
  else if (/\bnoc\b|\bpolnoc\b/i.test(t)) patch.time_of_day = 'night';

  return Object.keys(patch).length ? patch : null;
}