import OpenAI from 'openai';

const DEFAULT_TIMEOUT_MS = 120000;

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

function wrapClient(client) {
  const originalCreate = client.responses.create.bind(client.responses);
  client.responses.create = (args = {}, ...rest) => {
    const input = Array.isArray(args.input)
      ? args.input.map(sanitizeInputItem)
      : typeof args.input === 'string'
        ? sanitizeInternalOntologyDirectives(args.input)
        : args.input;
    return originalCreate({ ...args, input }, ...rest);
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
    }));
  }

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  return wrapClient(new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: timeoutMs(),
    maxRetries: 2,
  }));
}
