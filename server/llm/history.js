export const history = {
  openai: [],
  grok: [],
};

export function sanitizeForGrok(messages, limit = 6) {
  return messages.slice(-limit).map(m => ({
    role: m.role,
    content: '[previous context summarized]'
  }));
}
