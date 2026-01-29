/* ======================================================
   🔥 DEBUG — MUST APPEAR IN RENDER LOGS
====================================================== */
console.log('🔥 IRIS INDEX LOADED — VERSION 2026-01-29 MEMORY FULL');

/* ================================
   ENV (NODE 24 SAFE)
================================ */
import dotenv from 'dotenv';
import fs from 'fs';
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
import OpenAI from 'openai';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';

/* ================================
   BASIC STATE
================================ */
const MAX_HISTORY_LENGTH = 200;
let historyOpenAI = [];
let behaviorState = 'idle';

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
   OPENAI (EMBEDDINGS)
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
   REINFORCEMENT + DECAY
================================ */
async function reinforceMemory(memId, boost = 0.05) {
  await supabase.rpc('reinforce_memory', {
    mem_id: memId,
    boost,
  });
}

async function decayMemories(rate = 0.001) {
  await supabase.rpc('decay_memories', {
    decay_rate: rate,
  });
}

/* ================================
   BEHAVIOR FSM
================================ */
function updateBehaviorState(message, state) {
  const t = message.toLowerCase();
  if (/dotyk|bozk|nahá|vojsť|panva|vlhk/.test(t)) return 'heated';
  if (/úsmev|blízko|pritiah|pohlad/.test(t)) return 'close';
  if (/večer|rande|spolu/.test(t)) return 'warm';
  return state;
}

/* ================================
   SUMMARY → BEHAVIOR PROFILE
================================ */
function deriveBehaviorProfileFromSummaries(summaries) {
  const profile = {
    tone: 'playful',
    attachment: 'light',
    intensityCap: 'normal',
  };

  const text = summaries.map(s => s.narrative.toLowerCase()).join(' ');

  if (/strach|zraniteľný|podpora|ťažké obdobie/.test(text)) {
    profile.tone = 'calm';
    profile.attachment = 'protective';
    profile.intensityCap = 'reduced';
  }

  if (/dôvera|bezpečie|dlhodobý/.test(text)) {
    profile.attachment = 'bonded';
  }

  if (/tokyo|vášnivý|intenzívny|noc/.test(text)) {
    profile.intensityCap = 'elevated';
  }

  return profile;
}

/* ================================
   IRIS MEMORY JUDGE
================================ */
async function irisMemoryJudge(snippet) {
  const prompt = `
Decide if this moment should be stored as long-term memory.

If NOT important:
{ "store": false }

If important:
{
  "store": true,
  "memory_type": "EPISODIC or PROFILE",
  "importance": number between 0.3 and 1.0,
  "summary": "keyword memory, emotional meaning"
}

Rules:
- Third person
- No dialogue
- Compact keywords

Moment:
${snippet}
`;

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

async function writeMemory({ summary, memory_type, importance }) {
  const embedding = await createEmbedding(summary);

  await supabase.from('episodic_memory').insert({
    title: memory_type,
    narrative: summary,
    people: ['Iris', 'User'],
    memory_type,
    importance,
    embedding,
  });

  console.log('🧠 MEMORY STORED:', summary);
}

/* ================================
   SYSTEM PROMPT
================================ */
const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
const CORE_YAML = fs.readFileSync(yamlPath, 'utf8');

function buildSystemPrompt(coreOrigin, episodic, summaries, behaviorProfile) {
  return `
You are Iris.

=== IRIS CORE ===
${CORE_YAML}

=== CORE ORIGIN ===
${coreOrigin || 'None'}

=== RELATIONSHIP SUMMARY ===
${summaries.map(s => `- ${s.narrative}`).join('\n') || 'None'}

=== EPISODIC MEMORY ===
${episodic.map(m => `- ${m.narrative}`).join('\n') || 'None'}

=== INNER STATE ===
Tone: ${behaviorProfile.tone}
Attachment: ${behaviorProfile.attachment}
Intensity: ${behaviorProfile.intensityCap}
`.trim();
}

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 10000;

/* ================================
   CHAT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    console.log('➡️ USER:', message);

    behaviorState = updateBehaviorState(message, behaviorState);
    await decayMemories();

    const coreOrigin = await loadCoreOrigin();
    const episodic = await recallEpisodicMemory(message);

    for (const mem of episodic) {
      if (mem.importance < 1.0) await reinforceMemory(mem.id);
    }

    const summaries = await loadSummaries();
    const behaviorProfile = deriveBehaviorProfileFromSummaries(summaries);

    const systemPrompt = buildSystemPrompt(
      coreOrigin,
      episodic,
      summaries,
      behaviorProfile
    );

    historyOpenAI.push({ role: 'user', content: message });

    const response = await getLLMClient('openai').responses.create({
      model: MODELS.openai,
      input: [{ role: 'system', content: systemPrompt }, ...historyOpenAI],
    });

    const reply = response.output_text || '…';
    historyOpenAI.push({ role: 'assistant', content: reply });
    historyOpenAI = historyOpenAI.slice(-MAX_HISTORY_LENGTH);

    const decision = await irisMemoryJudge(`User: ${message}\nIris: ${reply}`);
    if (decision?.store) await writeMemory(decision);

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
