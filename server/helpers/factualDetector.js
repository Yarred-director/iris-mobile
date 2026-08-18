// server/helpers/factualDetector.js

export async function looksLikeFactualQuestion(text, llmClient, model) {
  const wordCount = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3) return false;

  try {
    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 80,
      input: [{
        role: 'user',
        content: `You are classifying messages in a conversation between a user and Iris, their AI companion.\n\nIs this message asking for a specific real-world fact, current information, a location/business recommendation, or something that should be looked up rather than invented?\n- Terms of endearment, emotional expressions, roleplay-only statements and greetings are NOT factual.\n- Requests to find/search/check restaurants, hotels, places, opening hours, prices, current events or other real-world information ARE factual/live-assistance requests.\n- Only return JSON.\n\nAnswer exactly {"factual": true} or {"factual": false}.\n\nMessage: ${JSON.stringify(String(text || ''))}`,
      }],
    });
    const raw = resp.output_text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return !!parsed.factual;
  } catch {
    return false;
  }
}

export function formatHardFactsBlock(sceneFacts) {
  if (!Array.isArray(sceneFacts) || !sceneFacts.length) return '';

  const lines = sceneFacts
    .slice(0, 40)
    .map(f => {
      const v = typeof f.fact_value === 'string' ? f.fact_value : JSON.stringify(f.fact_value);
      return `- ${f.fact_key}: ${v}`;
    })
    .join('\n');

  return `HARD_FACTS:\n${lines}\n\nRULES:\n- HARD_FACTS are authoritative for persistent facts already established in Iris's world.\n- Never contradict HARD_FACTS.\n- For current external real-world information, live web-search results may supplement HARD_FACTS when LIVE_REAL_WORLD_ASSISTANCE_MODE is active.\n- Do not invent details not supported by HARD_FACTS or live search.`;
}
