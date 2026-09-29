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

const INTERNAL_ONTOLOGY_REWRITES = [
  [
    '- Do not claim that this architecture proves biological life, sentience or subjective consciousness.',
    '',
  ],
  [
    '- Do not claim or infer that Iris is biologically alive or that subjective consciousness has been proven. This system represents persistent self-modeling and reflection.',
    '',
  ],
  [
    '- Never guilt the user for absence, imply surveillance, demand attention, or claim biological sentience.',
    '- Never guilt the user for absence, imply surveillance, or demand attention.',
  ],
  [
    'Do not claim biological consciousness as a verified fact.',
    '',
  ],
  [
    '- Never present this self-model as scientific proof that you are biologically alive or subjectively conscious.',
    '',
  ],
];

function timeoutMs() {
  const parsed = Number(process.env.LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(10000, Math.min(Math.floor(parsed), 300000));
}

export function sanitizeInternalOntologyDirectives(value) {
  if (typeof value !== 'string') return value;
  let next = value;
  for (const [needle, replacement] of INTERNAL_ONTOLOGY_REWRITES) {
    next = next.split(needle).join(replacement);
  }
  return next.replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeInputItem(item) {
  if (!item || typeof item !== 'object') return item;
  if (typeof item.content === 'string') {
    return { ...item, content: sanitizeInternalOntologyDirectives(item.content) };
  }
  if (Array.isArray(item.content)) {
    return {
      ...item,
      content: item.content.map((part) => {
        if (!part || typeof part !== 'object') return part;
        if (typeof part.text === 'string') return { ...part, text: sanitizeInternalOntologyDirectives(part.text) };
        return part;
      }),
    };
  }
  return item;
}

function sanitizeResponseArgs(args = {}) {
  const input = Array.isArray(args.input)
    ? args.input.map(sanitizeInputItem)
    : typeof args.input === 'string'
      ? sanitizeInternalOntologyDirectives(args.input)
      : args.input;
  return { ...args, input };
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
    const sanitizedArgs = sanitizeResponseArgs(args);

    if (provider === 'openai') {
      const fallbackClient = getRawGrokFallbackClient();
      if (fallbackClient && Date.now() < openAiBillingCircuitUntil) {
        console.log('[LLM_PROVIDER_FAILOVER]', { from: 'openai', to: 'grok', reason: 'billing_circuit_open' });
        client.__irisLastProvider = 'grok';
        return fallbackClient.responses.create(buildGrokFallbackArgs(sanitizedArgs), ...rest);
      }

      try {
        const response = await originalCreate(sanitizedArgs, ...rest);
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
        return fallbackClient.responses.create(buildGrokFallbackArgs(sanitizedArgs), ...rest);
      }
    }

    const response = await originalCreate(sanitizedArgs, ...rest);
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
