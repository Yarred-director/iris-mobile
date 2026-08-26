const URL_PATTERN = /https?:\/\/[^\s<>()\[\]{}"']+/giu;

export function extractHttpUrls(value, limit = 4) {
  const matches = String(value || '').match(URL_PATTERN) || [];
  const urls = [];
  for (const candidate of matches) {
    const trimmed = candidate.replace(/[.,!?;:]+$/u, '');
    try {
      const url = new URL(trimmed);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      urls.push(url.toString());
    } catch {}
  }
  return [...new Set(urls)].slice(0, Math.max(1, Math.min(Number(limit) || 4, 8)));
}

export function buildExactLinkDirective(urls) {
  if (!urls?.length) return '';
  return `USER_PROVIDED_LINKS:\n${urls.map((url) => `- ${url}`).join('\n')}\n- Use web search/browsing to open every exact user-provided URL before answering about its contents.\n- Never pretend you read a page when retrieval failed; say briefly that it could not be opened and ask the user to paste the relevant content.`;
}
