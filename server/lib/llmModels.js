// server/lib/llmModels.js

export const MODELS = {
  // Main conversational model: current OpenAI cost/intelligence sweet spot.
  openai: 'gpt-5.6-terra',
  // Cheap current-family model for classifiers/governance helpers.
  openaiUtility: 'gpt-5.6-luna',
  // Current xAI frontier chat model. Pin the documented production slug so upgrades are explicit and testable.
  grok: 'grok-4.6',
};
