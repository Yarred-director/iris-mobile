/* ================================
   ENV (NODE 24 SAFE)
================================ */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '.env'),
});

/* ================================
   IMPORTS
================================ */
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import OpenAI from 'openai';

/* ================================
   BASIC STATE
================================ */
const MAX_HISTORY_LENGTH = 20;
let conversationHistory = [];

/* ================================
   ENV VALIDATION
================================ */
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!process.env.IRIS_CORE_YAML) throw new Error('IRIS_CORE_YAML missing');

if (!process.env.XAI_API_KEY) {
  console.warn('⚠️ XAI_API_KEY missing – Grok disabled');
}

/* ================================
   SUPABASE
================================ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================================
   LLM CLIENT FACTORY
================================ */
function getLLMClient(provider = 'openai') {
  if (provider === 'grok' && process.env.XAI_API_KEY) {
    return new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    });
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

const MODELS = {
  openai: 'gpt-4.1',
  grok: 'grok-3',
};

/* ================================
   MEMORY (EMBEDDINGS – OPENAI ONLY)
================================ */
const embeddingClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function createEmbedding(text) {
  const res = await embeddingClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

async function recallEpisodicMemory(text, threshold = 0.6, count = 3) {
  const embedding = await createEmbedding(text);
  const { data } = await supabase.rpc('match_episodic_memory', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: count,
  });
  return data || [];
}

async function loadCoreOrigin() {
  const { data } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'CORE_ORIGIN')
    .limit(1);

  return data?.[0]?.narrative || null;
}

/* ================================
   SYSTEM PROMPT
================================ */
function buildSystemPrompt(coreYaml) {
  return `
You are Iris.

Everything about your identity, behavior, tone, boundaries,
language, intimacy and memory handling is defined BELOW.
You must strictly follow it.

Do not invent personality.
Do not add traits.
Do not override rules.

=== IRIS CORE (AUTHORITATIVE) ===
${coreYaml}
`.trim();
}

/* ================================
   LOAD YAML
================================ */
let SYSTEM_PROMPT = 'You are Iris.';

try {
  const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
  const rawYaml = fs.readFileSync(yamlPath, 'utf8');
  SYSTEM_PROMPT = buildSystemPrompt(rawYaml);
  console.log('🧠 IRIS CORE YAML loaded');
} catch (err) {
  console.error('❌ FAILED TO LOAD IRIS CORE YAML:', err.message);
}

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3001;

/* ================================
   AVATAR
================================ */
app.get('/ui/avatar/current', async (_req, res) => {
  const { data } = await supabase
    .from('avatars')
    .select('image_url, variant')
    .eq('is_active', true)
    .single();

  res.json(data);
});

/* ================================
   BACKGROUND
================================ */
app.get('/ui/chat-background', (_req, res) => {
  res.json({
    image_url:
      'https://glufbaseqhjkljhvdhmh.supabase.co/storage/v1/object/public/backgrounds/chat_default.png',
    overlay: { min: 0.26, max: 0.3, duration: 12000 },
    blur: 0,
    bottom_fade: true,
  });
});

/* ================================
   CHAT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message, llm } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    conversationHistory.push({ role: 'user', content: message });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    const coreOrigin = await loadCoreOrigin();
    const recalled = await recallEpisodicMemory(message);

    console.log('🔁 RECALL:', recalled.map(m => m.narrative));

    const memoryContext = `
${coreOrigin ? `CORE ORIGIN:\n${coreOrigin}\n` : ''}
${recalled.map(m => `MEMORY:\n${m.narrative}`).join('\n\n')}
`.trim();

    const provider =
      llm ||
      process.env.DEFAULT_LLM ||
      'openai';

    const client = getLLMClient(provider);
    const model = MODELS[provider] || MODELS.openai;

    console.log('🤖 LLM USED:', provider);

    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: memoryContext },
        ...conversationHistory,
      ],
    });

    const reply = response.output_text || '…';

    conversationHistory.push({ role: 'assistant', content: reply });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    res.json({ reply });
  } catch (err) {
    console.error('🔥 CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================
   START
================================ */
app.listen(PORT, () =>
  console.log(`🚀 Iris backend running on port ${PORT}`)
);
