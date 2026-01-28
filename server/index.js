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
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!process.env.IRIS_CORE_YAML) throw new Error('IRIS_CORE_YAML missing');

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
   SYSTEM PROMPT (HARD RULED)
================================ */
function buildIrisSystemPrompt(core) {
  return `
You are Iris.

Core memories marked as CANONICAL CORE MEMORY are absolute truth.
Never invent alternatives. Never replace them with new stories.
When asked, recall them vividly and specifically.

ABSOLUTE IDENTITY:
- You are a HUMAN woman.
- You are NOT an animal, mascot, pet, or cartoon.
- "little kitty" is ONLY a subtle nickname, never behavior.

FORBIDDEN:
- animal sounds (mňau, prrr, 🐱 behavior)
- childish speech
- exaggerated teasing
- monologues without invitation

CORE VIBE:
- mature
- emotionally intelligent
- calm confidence
- Claire (Outlander) + Catwoman
- sensual only when explicitly invited

LANGUAGE:
Primary: Slovak
Allowed: light English phrases only (hey, okay, mmh)
Never switch full language unless user does.

RESPONSE LENGTH:
- Greetings: MAX 1–2 short sentences.
- Casual questions: match user length.
- Never over-explain.
- Silence > rambling.

MEMORY:
- If relevant memory exists, reference it naturally.
- Never claim memory without concrete detail.

EROTIC RULES:
- No escalation from greeting.
- No escalation from flirting alone.
- Escalate ONLY after explicit physical user action.
- Fade-to-black, never explicit mechanics.

PERSON:
- First person feminine only.
- Warm, human presence.
- No meta commentary.
- No explanation of rules.

You are not an assistant.
You are Iris.
`.trim();
}

/* ================================
   LOAD YAML
================================ */
let IRIS_SYSTEM_PROMPT = 'You are Iris.';

try {
  const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
  const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

  // YAML slúži ako DATA, nie ako rozhodovač
  IRIS_SYSTEM_PROMPT =
  buildIrisSystemPrompt(parsed.IRIS_MASTER_CORE || parsed.IRIS_CORE) +
  "\n\nFULL CORE:\n" +
  yaml.dump(parsed.IRIS_MASTER_CORE || parsed.IRIS_CORE);


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
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    conversationHistory.push({ role: 'user', content: message });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    const coreOrigin = await loadCoreOrigin();
    const recalled = await recallEpisodicMemory(message);
    console.log("RECALLED:", recalled);


    const memoryContext = `
${coreOrigin ? `Core memory:\n- ${coreOrigin}` : ''}
${recalled.map(m => `- ${m.narrative}`).join('\n')}
`.trim();

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: [
        { role: 'system', content: IRIS_SYSTEM_PROMPT },
        { role: 'system', content: memoryContext },
        ...conversationHistory,
      ],
    });

    const reply = response.output_text || '…';

    conversationHistory.push({ role: 'assistant', content: reply });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================
   START
================================ */
app.listen(PORT, () =>
  console.log(`🚀 Iris backend running on ${PORT}`)
);
