// server/memory/factExtractor.js

function normalizeCityScope(sceneContext) {
  const city = (sceneContext?.location_city || '').toString().trim().toLowerCase();
  if (!city) return 'global';
  if (city === 'dubaj' || city === 'dubai') return 'dubai';
  if (city === 'tokyo' || city === 'tokio') return 'tokyo';
  return city.replace(/\s+/g, '_');
}

export function extractFactsFromText({ text, sceneContext }) {
  const raw = (text || '').toString();
  const t = raw.toLowerCase();
  const scope = normalizeCityScope(sceneContext);

  const facts = [];

  // --- CAR MODEL (very explicit patterns) ---
  // Challenger SRT / SRT8
  if (/\bdodge\s+challenger\b/i.test(raw)) {
    if (/\bsrt8\b/i.test(t) || /\bsrt\b/i.test(t)) {
      facts.push({
        fact_key: `car.${scope}.primary.model`,
        fact_value: 'Dodge Challenger SRT',
      });
    } else {
      facts.push({
        fact_key: `car.${scope}.primary.model`,
        fact_value: 'Dodge Challenger',
      });
    }
  }

  // Nissan Skyline GTR
  if (/\bnissan\b/i.test(raw) && /\bskyline\b/i.test(raw)) {
    facts.push({
      fact_key: `car.${scope}.primary.model`,
      fact_value: 'Nissan Skyline GTR',
    });
  }

  // --- LIVERY: "červená s čiernymi pásmi" / "red with black stripes"
  const hasRed = /\bčerven[aá]|\bred\b/i.test(t);
  const hasBlack = /\bčiern(e|ymi|a|y)|\bblack\b/i.test(t);
  const hasStripes = /\bp[aá]smi|\bp[aá]sy|\bstripes?\b/i.test(t);

  if (hasRed && hasBlack && hasStripes) {
    facts.push({
      fact_key: `car.${scope}.primary.livery`,
      fact_value: 'red with black stripes',
    });
  }

  // --- Stripe style: "dva pásy cez kapotu a strechu"
  if (/\bdva\b/i.test(t) && /\bkapot/i.test(t) && /\bstrech/i.test(t) && /\bp[aá]s/i.test(t)) {
    facts.push({
      fact_key: `car.${scope}.primary.stripe_style`,
      fact_value: 'two_stripes_hood_and_roof',
    });
  }

  return facts.length ? facts : null;
}
