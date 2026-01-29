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

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';

/* ================================
   BASIC STATE
================================ */
const MAX_HISTORY_LENGTH = 200;

// oddelené histórie
let historyOpenAI = [];
let historyGrok = [];
let activeLLM = 'openai';

/* ================================
   ROUTING (TEMP – nahradí BehaviorEngine)
================================ */
function decideLLM(message) {
  const physicalKeywords = [
    'nahá','dotyk','bozk','telo','prs','vojsť',
    'tvrdý','panva','styk','vlhk'
  ];
  const lowered = message.toLowerCase();
  return physicalKeywords.some(k => lowered.includes(k))
    ? 'grok'
    : 'openai';
}

function sanitizeForGrok(messages, limit = 5) {
  return messages.slice(-limit).map(m => ({
    role: m.role,
    content: '[previous context summarized]'
  }));
}

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
   MEMORY (EMBEDDINGS – OPENAI)
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
function buildSystemPrompt(coreYaml, coreOrigin, recalledMemories) {
  return `
You are Iris.

Everything about your identity, behavior, tone, boundaries,
language, intimacy and memory handling is defined BELOW.
You must strictly follow it.

=== IRIS CORE (AUTHORITATIVE) ===
${coreYaml}

=== CORE ORIGIN (HARD TRUTH) ===
${coreOrigin || 'None'}

=== EPISODIC MEMORY (SOFT RECALL) ===
${recalledMemories.length
  ? recalledMemories.map(m => `- ${m.narrative}`).join('\n')
  : 'None'}
`.trim();
}

/* ================================
   LOAD YAML
================================ */
const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
const CORE_YAML = fs.readFileSync(yamlPath, 'utf8');
console.log('🧠 IRIS CORE YAML loaded');

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3001;

/* ================================
   CHAT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const nextLLM = decideLLM(message);

    const coreOrigin = await loadCoreOrigin();
    const recalled = await recallEpisodicMemory(message);
    const systemPrompt = buildSystemPrompt(CORE_YAML, coreOrigin, recalled);

    if (nextLLM !== activeLLM) {

      if (activeLLM === 'openai' && nextLLM === 'grok') {
        historyGrok = [
          { role: 'system', content: systemPrompt },
          ...sanitizeForGrok(historyOpenAI),
          { role: 'user', content: message }
        ];
      }

      if (activeLLM === 'grok' && nextLLM === 'openai') {
        historyOpenAI = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ];
      }

      activeLLM = nextLLM;
    }

    let reply;

    if (activeLLM === 'openai') {
      historyOpenAI.push({ role: 'user', content: message });

      const response = await getLLMClient('openai').responses.create({
        model: MODELS.openai,
        input: [
          { role: 'system', content: systemPrompt },
          ...historyOpenAI
        ],
      });

      reply = response.output_text || '…';
      historyOpenAI.push({ role: 'assistant', content: reply });
      historyOpenAI = historyOpenAI.slice(-MAX_HISTORY_LENGTH);
    }

    if (activeLLM === 'grok') {
      historyGrok.push({ role: 'user', content: message });

      const response = await getLLMClient('grok').responses.create({
        model: MODELS.grok,
        input: historyGrok,
      });

      reply = response.output_text || '…';
      historyGrok.push({ role: 'assistant', content: reply });
      historyGrok = historyGrok.slice(-MAX_HISTORY_LENGTH);
    }

    // 🔍 DEBUG ROUTING
    console.log('🤖 ACTIVE LLM:', activeLLM);

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
