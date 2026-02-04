// server/memory/contextJudge.js
export function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString();
  const t = raw.toLowerCase();

  // --- GENERIC LOCATION: "sme v X" alebo "v X" ---
  // Nevymýšľa, len chytí explicitné X (do interpunkcie/konca riadku)
  // Preferujeme location_city ako "label" (neskôr môžeš spraviť confirmation flow city vs country)
  if (!sceneContext?.location_city && !sceneContext?.location_country) {
    // "sme v X"
    let m = raw.match(/\bsme\s+v\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (!m) {
      // "v X" (ak user len povie "v Mexiku...")
      m = raw.match(/\bv\s+(.+?)(?=[\.,;!?\n]|$)/i);
    }
    if (m && m[1]) {
      const loc = m[1].trim();
      if (loc.length >= 3 && loc.length <= 60) patch.location_city = loc;
    }
  }

  // --- PLACE: "na X" ---
  if (!sceneContext?.place) {
    const m = raw.match(/\bna\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[1]) {
      const place = m[1].trim();
      if (place.length >= 3 && place.length <= 80) patch.place = place;
    }
  }

  // --- ROOM (generic keywords) ---
  if (!sceneContext?.room) {
    if (/\bapartm[aá]n|\bapartm[aá]ne|\bapartm[aá]te/i.test(t)) patch.room = 'apartment';
    else if (/\bsp[aá]l[nň]a|\bposte[lľ]/i.test(t)) patch.room = 'bedroom';
    else if (/\bkuchy[nň]/i.test(t)) patch.room = 'kitchen';
  }

  // --- TIME OF DAY (explicit only) ---
  if (/\bje\s+r[aá]no\b|\bdobr[eé]\s+r[aá]no\b|\br[aá]nko\b/i.test(t)) patch.time_of_day = 'morning';
  else if (/\bje\s+ve[cč]er\b|\bdobr[ýy]\s+ve[cč]er\b/i.test(t)) patch.time_of_day = 'evening';
  else if (/\bnoc\b|\bpolnoc\b/i.test(t)) patch.time_of_day = 'night';

  return Object.keys(patch).length ? patch : null;
}
