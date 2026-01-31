function normalizeSceneKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // odstráni diakritiku
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function extractSceneFromMessage(message = '') {
  const m = String(message);

  // SK/CZ: "v Tokyu", "vo Viedni" (vezmeme nasledujúce slovo)
  let match = m.match(/\b(v|vo)\s+([A-Za-zÀ-ž0-9_-]{2,})\b/i);
  if (match?.[2]) return normalizeSceneKey(match[2]);

  // EN: "in Tokyo"
  match = m.match(/\bin\s+([A-Za-zÀ-ž0-9_-]{2,})\b/i);
  if (match?.[1]) return normalizeSceneKey(match[1]);

  return null;
}

export function detectSceneKey({ message, episodic = [] }) {
  // 1) skús vytiahnuť zo správy
  const fromMsg = extractSceneFromMessage(message);
  if (fromMsg) return fromMsg;

  // 2) fallback z episodic location
  const counts = new Map();
  for (const mem of episodic) {
    const loc = mem?.location;
    if (!loc) continue;
    const key = normalizeSceneKey(loc);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let bestKey = null, bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount) { bestKey = k; bestCount = c; }
  }

  return bestKey || 'global';
}
