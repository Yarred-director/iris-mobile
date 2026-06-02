// server/helpers/factualDetector.js

export async function looksLikeFactualQuestion(text, llmClient, model) {
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount <= 3) return false;

  try {
    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 50,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `You are classifying messages in a conversation between a user and Iris, their AI companion.

Is this message a SPECIFIC FACTUAL QUESTION requiring a precise answer (a number, date, location, technical spec)?
- Terms of endearment, nicknames, emotional expressions, and greetings are NOT factual questions.
- Vague questions, feelings, opinions, and relationship topics are NOT factual questions.
- Only return true for clear factual queries like "What is the capital of France?" or "How tall is Eiffel Tower?"

Answer only {"factual": true} or {"factual": false}.

Message: "${text}"`,
      }],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
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

  return `HARD_FACTS:\n${lines}\n\nRULES:\n- HARD_FACTS are the single source of truth for factual questions.\n- Never contradict HARD_FACTS.\n- If a user asks a factual question and the answer is not in HARD_FACTS, say you don't know and ask a short follow-up.\n- Do not invent details not present in HARD_FACTS.`;
}