const LIVE_LOOKUP_SIGNAL = /\b(vyhľadaj|vyhladaj|nájdi|najdi|pozri|over|skontroluj|search|find|look\s*up|check)\b/iu;
const CURRENT_WORLD_SIGNAL = /\b(reštaur|restaur|restaurant|bar|kaviare|cafe|hotel|obchod|shop|miesto|place|podnik|venue|otvoren|open|cena|price|menu|rezerv|booking|nearby|v okolí|v okoli|blízko|blizko|around|near)\w*/iu;
const FRESHNESS_SIGNAL = /\b(aktuál|aktual|dnes|teraz|latest|current|today|tonight|now)\w*/iu;

export function looksLikeLiveAssistanceRequest(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (LIVE_LOOKUP_SIGNAL.test(value)) return true;
  return CURRENT_WORLD_SIGNAL.test(value) && FRESHNESS_SIGNAL.test(value);
}

export function buildLiveAssistanceDirective(sceneContext = {}) {
  const city = sceneContext?.location_city || sceneContext?._resolved?.city || '';
  const country = sceneContext?.location_country || sceneContext?._resolved?.country || '';
  const place = sceneContext?.place || '';
  const locationHint = [place, city, country].filter(Boolean).join(', ');

  return `LIVE_REAL_WORLD_ASSISTANCE_MODE:\n- The user is asking Iris to actually look up current real-world information. Use web search before answering.\n- Real web results are an allowed factual source for this response; HARD_CONTEXT still defines the roleplay location and must not be contradicted.\n- Stay fully in character as Iris. Do not announce a mode switch or break roleplay.\n- Treat the roleplay world as anchored to the real-world location${locationHint ? `: ${locationHint}` : ''}. Use that location when the user says things like \"near us\", \"around our apartment\", or \"nearby\".\n- For local recommendations, return a small useful shortlist with concrete real names and why each fits. Prefer currently operating places and do not invent distance, opening hours, prices, ratings, or availability.\n- If the roleplay location is too vague to search locally, ask one short location clarification instead of guessing.\n- Clearly distinguish what was found live from Iris's personal/roleplay memories, but phrase it naturally in-character.`;
}
