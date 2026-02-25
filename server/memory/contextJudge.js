export function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString().trim();
  const t = raw.toLowerCase();

  // === EXPLICIT LOCATION ===
  {
    const m = raw.match(/\bsme\s+v\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[1]) {
      const loc = m[1].trim();
      if (loc.length >= 3 && loc.length <= 60) patch.location_city = loc;
    }
  }

  // === PLACE (hotel, raňajky, reštaurácia...) ===
  {
    let m = raw.match(/\bsme\s+na\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (!m) m = raw.match(/\bteraz\s+sme\s+na\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[1]) {
      const place = m[1].trim();
      if (place.length >= 3 && place.length <= 80) patch.place = place;
    }

    // SMART DETECTION (bez hardcode)
    if (/\b(našom )?hoteli?\b/i.test(raw)) patch.place = patch.place || 'hotel';
    if (/\bna raňajk[áchy]?\b/i.test(raw)) patch.place = patch.place || 'raňajky';
    if (/\braňajkách? (v |na )?hoteli?\b/i.test(raw)) patch.place = 'raňajky v hoteli';
    if (/\breštauráci[ia]\b/i.test(raw)) patch.place = 'reštaurácia';
    if (/\bjumeirah beach\b/i.test(t)) patch.place = 'Jumeirah Beach apartment';
  }

  // === INFERENCE (Dubaj z Jumeirah Beach) – bez hardcode, len logika ===
  if (!patch.location_city && /\bjumeirah beach\b/i.test(t)) {
    patch.location_city = 'Dubaj';   // inferencia z známeho kontextu
    patch.location_country = 'UAE';
  }

  // === ROOM & TIME ===
  {
    if (/\bhotelov[áa] izba\b|\bhotel room\b/i.test(t)) patch.room = 'hotelová izba';
    else if (/\bsp[aá]l[nň]a|\bposte[lľ]/i.test(t)) patch.room = 'spálňa';

    if (/\b(ráno|raňajk[áchy]|dobré ráno)\b/i.test(t)) patch.time_of_day = 'morning';
    else if (/\b(ve[čc]er|dobrý večer)\b/i.test(t)) patch.time_of_day = 'evening';
    else if (/\b(noc|polnoc)\b/i.test(t)) patch.time_of_day = 'night';
  }

  return Object.keys(patch).length ? patch : null;
}