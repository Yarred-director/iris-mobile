export function detectState(input) {
  // 🛡️ HARD GUARD – vždy pracujeme len so stringom
  const text =
    typeof input === 'string'
      ? input
      : typeof input?.content === 'string'
        ? input.content
        : '';

  const t = text.toLowerCase();

  if (
    t.includes('chytím') ||
    t.includes('bozk') ||
    t.includes('pritlač') ||
    t.includes('tvrdo')
  ) {
    return 'heated';
  }

  if (
    t.includes('ahoj') ||
    t.includes('dobré ránko') ||
    t.includes('dobre ranko')
  ) {
    return 'warm';
  }

  return 'idle';
}
