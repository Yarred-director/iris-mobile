import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import yaml from 'js-yaml';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================================
   KRÁTKODOBÁ PAMÄŤ
================================ */
const MAX_HISTORY_LENGTH = 20;
let conversationHistory = [];

/* ================================
   SUPABASE
================================ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ service role, nie anon
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

async function storeEpisodicMemory(memory) {
  const embedding = await createEmbedding(memory.narrative);
  await supabase.from('episodic_memory').insert({ ...memory, embedding });
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

/* ================================
   CORE ORIGIN — VŽDY NAČÍTANÝ
================================ */
async function loadCoreOrigin() {
  const { data } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'CORE_ORIGIN')
    .limit(1);

  return data?.[0]?.narrative || null;
}

/* ================================
   C-NEXT-3: REINFORCE
================================ */
async function reinforceMemories(memories) {
  for (const m of memories) {
    if (m.memory_type === 'CORE_ORIGIN') continue;

    const caps = {
      RELATIONSHIP: 90,
      PERSONAL: 80,
      MOMENT: 60,
    };

    const next = Math.min(
      (m.memory_strength || 50) + 5,
      caps[m.memory_type] || 80
    );

    await supabase
      .from('episodic_memory')
      .update({ memory_strength: next })
      .eq('id', m.id);
  }
}

/* ================================
   C-NEXT-3: DECAY
================================ */
async function decayMemories() {
  const { data } = await supabase
    .from('episodic_memory')
    .select('*')
    .neq('memory_type', 'CORE_ORIGIN');

  for (const m of data || []) {
    const floors = {
      RELATIONSHIP: 40,
      PERSONAL: 30,
      MOMENT: 10,
    };

    const next = Math.max(
      (m.memory_strength || 50) - 1,
      floors[m.memory_type] || 30
    );

    if (next !== m.memory_strength) {
      await supabase
        .from('episodic_memory')
        .update({ memory_strength: next })
        .eq('id', m.id);
    }
  }
}

/* ================================
   SYSTEM PROMPT (YAML)
================================ */
function buildIrisSystemPrompt(core) {
  return `
You are ${core.identity?.name || 'Iris'}.

Priority rule:
Your personality is ALWAYS active.
Never be neutral. Never be generic.

Tone:
Warm, confident, playful, teasing.

Identity:
- Alias: ${core.identity?.alias || 'little_kitty'}

Core statement:
${core.identity?.core_statement || ''}

Language: ${core.meta?.language_default || 'sk'}
Stay in character. Fade-to-black for intimacy.
`.trim();
}

/* ================================
   LOAD YAML
================================ */
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
   🖼️ AVATAR ENDPOINT (NOVÉ)
================================ */
app.get('/api/avatar/current', async (_req, res) => {
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

    await reinforceMemories(recalled);

    const memoryContext = `
${coreOrigin ? `Core shared origin (always true):\n- ${coreOrigin}\n` : ''}
${recalled.length ? `Other remembered facts:\n${recalled
      .map(m => `- ${m.narrative}`)
      .join('\n')}` : ''}
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
decayMemories().catch(() => {});
app.listen(PORT, () =>
  console.log(`🚀 Iris backend running on port ${PORT}`)
);
