import OpenAI from 'openai';

const DEFAULT_TIMEOUT_MS = 120000;

function timeoutMs() {
  const parsed = Number(process.env.LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(10000, Math.min(Math.floor(parsed), 300000));
}

export function getLLMClient(provider = 'openai') {
  if (provider === 'grok') {
    if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY missing');
    return new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
      timeout: timeoutMs(),
      maxRetries: 2,
    });
  }

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: timeoutMs(),
    maxRetries: 2,
  });
}
