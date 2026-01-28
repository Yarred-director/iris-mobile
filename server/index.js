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
import yaml from 'js-yaml';
import OpenAI from 'openai';

/* ================================
   BASIC STATE
================================ */
const MAX_HISTORY_LENGTH = 20;
let conversationHistory = [];

/* ================================
   ENV VALIDATION
================================ */
if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL is missing');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing');
}
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is missing');
}

/* ================================
   SUPABASE
================================ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================================
   OPENAI
================================ */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ================================
   EMBEDDINGS
================================ */
async function createEmbedding(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

async function recallEpisodicMemory(text, threshold = 0.6, count = 3) {
  const embedding = await createEmbedding(text);
  const { data, error } = await supabase.rpc('match_episodic_memory', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: count,
  });
  if (error) throw error;
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
   SYSTEM PROMPT (YAML)
================================ */
function buildIrisSystemPrompt(core) {
  return `
You are ${core.identity?.name || 'Iris'}.

Priority rule:
Your personality is ALWAYS active.

Tone:
Warm, confident, playful, teasing.

Alias:
${core.identity?.alias || 'little_kitty'}

Language:
${core.meta?.language_default || 'sk'}
`.trim();
}

let IRIS_SYSTEM_PROMPT = 'You are Iris.';
try {
  const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
  const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
  IRIS_SYSTEM_PROMPT = buildIrisSystemPrompt(parsed.IRIS_CORE);
  console.log('🧠 IRIS_CORE loaded');
} catch (err) {
  console.warn('⚠️ IRIS_CORE YAML not loaded:', err.message);
}

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

/* ================================
   🖼️ AVATAR ENDPOINT
================================ */
app.get('/ui/avatar/current', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('avatars')
      .select('image_url, variant')
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'No active avatar found' });
    }

    res.json(data);
  } catch (err) {
    console.error('🔥 AVATAR ERROR:', err);
    res.status(500).json({ error: 'Avatar fetch failed' });
  }
});

/* ================================
   🖼️ CHAT BACKGROUND (KANONICKÝ)
================================ */
app.get('/ui/chat-background', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');

  res.json({
    image_url:
      'https://glufbaseqhjkljhvdhmh.supabase.co/storage/v1/object/public/backgrounds/chat_default.png',
    overlay: {
      min: 0.26,
      max: 0.30,
      duration: 12000,
    },
    blur: 0,
    bottom_fade: true,
  });
});

/* ================================
   CHAT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    conversationHistory.push({ role: 'user', content: message });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    const coreOrigin = await loadCoreOrigin();
    const recalled = (await recallEpisodicMemory(message)).filter(
      m => m.memory_strength >= 50
    );

    const memoryContext = `
${coreOrigin ? `Core:\n- ${coreOrigin}\n` : ''}
${recalled.length ? recalled.map(m => `- ${m.narrative}`).join('\n') : ''}
`.trim();

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        { role: 'system', content: IRIS_SYSTEM_PROMPT + '\n\n' + memoryContext },
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
