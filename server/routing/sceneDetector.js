function normalizeSceneKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function detectSceneKey({ episodic = [] }) {
  const counts = new Map();

  for (const m of episodic) {
    const loc = m?.location;
    if (!loc) continue;
    const key = normalizeSceneKey(loc);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let bestKey = null;
  let bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }

  return bestKey || 'global';
}
