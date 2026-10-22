// Language-neutral cost gate for the memory pipeline. Semantic decisions (what to remember,
// image requests, live lookups) come from the turn classifier, never from keyword lists.

export function shouldRunSemanticRecall(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  // Count graphemes so scripts without spaces (CJK, Thai) are treated like spaced languages.
  const graphemes = Array.from(value).length;
  return value.split(/\s+/u).length >= 3 || graphemes >= 12;
}
