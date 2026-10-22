import OpenAI from 'openai';
import { MODELS } from './llmModels.js';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_OPENAI_BILLING_FAILOVER_MS = 5 * 60 * 1000;

let openAiBillingCircuitUntil = 0;
let cachedGrokFallbackClient = null;

function openAiBillingFailoverMs() {
  const parsed = Number(process.env.OPENAI_BILLING_FAILOVER_MS || DEFAULT_OPENAI_BILLING_FAILOVER_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_OPENAI_BILLING_FAILOVER_MS;
  return Math.max(30000, Math.min(Math.floor(parsed), 30 * 60 * 1000));
}

export function isOpenAiBillingUnavailable(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = String(error?.code || error?.error?.code || '').toLowerCase();
  const message = String(error?.message || error?.error?.message || '').toLowerCase();
  if (status !== 429 && !code) return false;
  return [
    'credit_balance_exhausted',
    'insufficient_quota',
    'billing_hard_limit_reached',
  ].includes(code)
    || message.includes('no credits remaining')
    || message.includes('credit balance')
    || message.includes('billing hard limit');
}

export function buildGrokFallbackArgs(args = {}) {
  return {
    ...args,
    model: MODELS.grok,
    reasoning: { effort: 'low' },
  };
}

function timeoutMs() {
  const parsed = Number(process.env.LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(10000, Math.min(Math.floor(parsed), 300000));
}

function getRawGrokFallbackClient() {
  if (!process.env.XAI_API_KEY) return null;
  if (!cachedGrokFallbackClient) {
    cachedGrokFallbackClient = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
      timeout: timeoutMs(),
      maxRetries: 2,
    });
  }
  return cachedGrokFallbackClient;
}

function wrapClient(client, provider) {
  const originalCreate = client.responses.create.bind(client.responses);
  client.responses.create = async (args = {}, ...rest) => {
    if (provider === 'openai') {
      const fallbackClient = getRawGrokFallbackClient();
      if (fallbackClient && Date.now() < openAiBillingCircuitUntil) {
        console.log('[LLM_PROVIDER_FAILOVER]', { from: 'openai', to: 'grok', reason: 'billing_circuit_open' });
        client.__irisLastProvider = 'grok';
        return fallbackClient.responses.create(buildGrokFallbackArgs(args), ...rest);
      }

      try {
        const response = await originalCreate(args, ...rest);
        client.__irisLastProvider = 'openai';
        return response;
      } catch (error) {
        if (!fallbackClient || !isOpenAiBillingUnavailable(error)) throw error;
        openAiBillingCircuitUntil = Date.now() + openAiBillingFailoverMs();
        console.log('[LLM_PROVIDER_FAILOVER]', {
          from: 'openai',
          to: 'grok',
          reason: error?.code || 'openai_billing_unavailable',
          retry_after_ms: openAiBillingFailoverMs(),
        });
        client.__irisLastProvider = 'grok';
        return fallbackClient.responses.create(buildGrokFallbackArgs(args), ...rest);
      }
    }

    const response = await originalCreate(args, ...rest);
    client.__irisLastProvider = provider;
    return response;
  };
  return client;
}

export function getLLMClient(provider = 'openai') {
  if (provider === 'grok') {
    if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY missing');
    return wrapClient(new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
      timeout: timeoutMs(),
      maxRetries: 2,
    }), 'grok');
  }

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  return wrapClient(new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: timeoutMs(),
    maxRetries: 2,
  }), 'openai');
}
