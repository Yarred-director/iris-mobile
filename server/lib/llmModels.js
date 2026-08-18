// server/lib/llmModels.js

export const MODELS = {
  // Main conversational model: current OpenAI cost/intelligence sweet spot.
  openai: 'gpt-5.6-terra',
  // Cheap current-family model for classifiers/governance helpers.
  openaiUtility: 'gpt-5.6-luna',
  // xAI recommends Grok 4.5 for chat/tool workflows; -latest follows stable upgrades.
  grok: 'grok-4.5-latest',
};
