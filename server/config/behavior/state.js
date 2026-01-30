export function detectState(text) {
  const t = text.toLowerCase();

  if (/nahá|vlhk|panva|tvrd|vojsť|sex|intím|zadok|prsia|chyti|pritla|stisn|telo|bok|bozk/.test(t))
    return 'heated';

  if (/bozk|dotyk|pritiah|pohlad/.test(t)) return 'close';
  if (/rande|večer|spolu/.test(t)) return 'warm';

  return 'idle';
}
