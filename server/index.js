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

let historyOpenAI = [];
let historyGrok = [];
let activeLLM = 'openai';

// 🧠 Behavior FSM
let behaviorState = 'idle';

/* ================================
   BEHAVIOR ENGINE (FSM)
================================ */
function updateBehaviorState(message, currentState) {
  const text = message.toLowerCase();

  const signals = {
    physical: /dotyk|bozk|prs|nahá|vojsť|tvrdý|vlhk|panva/.test(text),
    flirt: /úsmev|zavrn|blízko|pritiah|pohlad/.test(text),
    romantic: /večer|park|rande|spolu|chcem byť/.test(text),
    pullback: /čo máš v pláne|len tak|poďme/.test(text),
  };

  switch (currentState) {
    case 'idle':
      if (signals.romantic || signals.flirt) return 'warm';
      return 'idle';

    case 'warm':
      if (signals.flirt) return 'teasing';
      if (signals.physical) return 'close';
      return 'warm';

    case 'teasing':
      if (signals.physical) return 'close';
      return 'teasing';

    case 'close':
      if (signals.physical) return 'heated';
      if (signals.pullback) return 'teasing';
      return 'close';

    case 'heated':
      if (signals.pullback) return 'close';
      return 'heated';

    default:
      return 'idle';
  }
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
   EMBEDDINGS (OPENAI)
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

/* ================================
   MEMORY LOADERS
================================ */
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

async function loadSummaries(limit = 2) {
  const { data } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'SUMMARY')
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
}

/* ================================
   SYSTEM PROMPT
================================ */
function buildSystemPrompt(coreYaml, coreOrigin, episodic, summaries) {
  return `
You are Iris.

Everything about your identity, behavior, tone, boundaries,
language and memory handling is defined BELOW.
You must strictly follow it.

=== IRIS CORE ===
${coreYaml}

=== CORE ORIGIN ===
${coreOrigin || 'None'}

=== RELATIONSHIP SUMMARY ===
${summaries.length ? summaries.map(s => `- ${s.narrative}`).join('\n') : 'None'}

=== EPISODIC MEMORY ===
${episodic.length ? episodic.map(m => `- ${m.narrative}`).join('\n') : 'None'}
`.trim();
}

/* ================================
   LOAD YAML
================================ */
const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
const CORE_YAML = fs.readFileSync(yamlPath, 'utf8');
console.log('🧠 IRIS CORE YAML loaded');

/* ================================
   IRIS MEMORY JUDGE
================================ */
async function irisMemoryJudge({ systemPrompt, snippet }) {
  const prompt = `
Decide if this moment should be stored as long-term memory.

If NOT important:
{ "store": false }

If important:
{
  "store": true,
  "memory_type": "EPISODIC or PROFILE",
  "summary": "keyword style memory with emotional layer"
}

Rules:
- No dialogue
- No explicit sex
- Third person
- Keyword / phrase style
- Focus on meaning

Moment:
${snippet}
`.trim();

  const res = await getLLMClient('openai').responses.create({
    model: MODELS.openai,
    input: [{ role: 'user', content: prompt }],
  });

  try {
    return JSON.parse(res.output_text);
  } catch {
    return { store: false };
  }
}

async function writeMemory({ summary, memory_type }) {
  const embedding = await createEmbedding(summary);

  await supabase.from('episodic_memory').insert({
    title: memory_type === 'PROFILE' ? 'Profile Shift' : 'Episodic Moment',
    narrative: summary,
    people: ['Iris', 'User'],
    memory_type,
    embedding
  });
}

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

    behaviorState = updateBehaviorState(message, behaviorState);
    const nextLLM = behaviorState === 'heated' ? 'grok' : 'openai';

    const coreOrigin = await loadCoreOrigin();
    const episodic = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    const systemPrompt = buildSystemPrompt(
      CORE_YAML,
      coreOrigin,
      episodic,
      summaries
    );

    // 🔁 ONE-WAY BRIDGE
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

    console.log('🧠 STATE:', behaviorState, '🤖 LLM:', activeLLM);

    // 🧠 MEMORY JUDGE
    const decision = await irisMemoryJudge({
      systemPrompt,
      snippet: `User: ${message}\nIris: ${reply}`
    });

    if (decision?.store) {
      await writeMemory(decision);
      console.log('🧠 MEMORY STORED:', decision.memory_type, decision.summary);
    }

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
