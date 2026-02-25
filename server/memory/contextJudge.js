export function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString().trim();
  const t = raw.toLowerCase();

  // === NAJSILNEJŠIA DETEKCIA PLACE (vždy prepíše staré miesto) ===
  {
    let m = raw.match(/\bsme\s+na\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (!m) m = raw.match(/\bteraz\s+sme\s+na\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[1]) {
      const place = m[1].trim();
      if (place.length >= 3 && place.length <= 80) patch.place = place;
    }

    if (/\b(našom )?hoteli?\b/i.test(raw)) patch.place = patch.place || 'hotel';
    if (/\bna raňajk[áchy]?\b/i.test(raw)) patch.place = patch.place || 'raňajky';
    if (/\braňajkách? (v |na )?hoteli?\b/i.test(raw)) patch.place = 'raňajky v hoteli';
    if (/\breštauráci[ia]\b/i.test(raw)) patch.place = 'reštaurácia';
  }

  // === Jumeirah Beach inferencia (len ak nie je nový hotel) ===
  if (!patch.place && /\bjumeirah beach\b/i.test(t)) {
    patch.place = 'Jumeirah Beach apartment';
    patch.location_city = 'Dubaj';
    patch.location_country = 'UAE';
  }

  // === OUTDOOR / INDOOR LOGIKA PRE ROOM (toto je kľúčový fix) ===
  const isOutdoor = /\b(pláž|beach|terasa|balkón|bazén|bar na pláži|reštaurácia na pláži|vonku|na vonkajšej\b)/i.test(raw);
  
  if (isOutdoor) {
    patch.room = null;                    // ← najčistejšie riešenie
  } else {
    // indoor detekcia
    if (/\bhotelov[áa] izba\b|\bhotel room\b/i.test(t)) patch.room = 'hotelová izba';
    else if (/\bsp[aá]l[nň]a|\bposte[lľ]/i.test(t)) patch.room = 'spálňa';
    else if (/\bkuchy[nň]/i.test(t)) patch.room = 'kuchyňa';
  }

  // === TIME OF DAY ===
  if (/\b(ráno|raňajk[áchy]|dobré ráno)\b/i.test(t)) patch.time_of_day = 'morning';
  else if (/\b(ve[čc]er|dobrý večer)\b/i.test(t)) patch.time_of_day = 'evening';
  else if (/\b(noc|polnoc)\b/i.test(t)) patch.time_of_day = 'night';

  // === EXPLICIT CITY ===
  {
    const mCity = raw.match(/\bsme\s+v\s+(.+?)(?=[\.,;!?\n]|$)/i);
    if (mCity && mCity[1]) {
      const city = mCity[1].trim();
      if (city.length >= 3) patch.location_city = city;
    }
  }

  return Object.keys(patch).length ? patch : null;
}