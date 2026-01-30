/* ======================================================
   🔥 DEBUG
====================================================== */
console.log('🔥 IRIS INDEX LOADED — DUAL LLM ROUTING ACTIVE');

/* ================================
   ENV
================================ */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

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
   STATE
================================ */
const MAX_HISTORY = 200;

let historyOpenAI = [];
let historyGrok = [];
let activeLLM = 'openai';
let behaviorState = 'idle';

/* ================================
   VALIDATION
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
   EMBEDDINGS
================================ */
const embeddingClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function createEmbedding(text) {
  const res = await embeddingClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

/* ================================
   MEMORY  ✅ FIXED
================================ */
async function recallEpisodicMemory(text) {
  const embedding = await createEmbedding(text);
  const { data } = await supabase.rpc('match_episodic_memory', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 6,
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

async function loadSummaries() {
  const { data } = await supabase
    .from('episodic_memory')
    .select('narrative')
    .eq('memory_type', 'SUMMARY')
    .order('created_at', { ascending: false })
    .limit(2);
  return data || [];
}

async function reinforceMemory(id) {
  await supabase.rpc('reinforce_memory', { mem_id: id, boost: 0.05 });
}

async function decayMemories() {
  await supabase.rpc('decay_memories', { decay_rate: 0.001 });
}

/* ================================
   BEHAVIOR + ROUTING
================================ */
function detectState(text) {
  const t = text.toLowerCase();

  if (/nahá|vlhk|panva|tvrd|vojsť|sex|intím|zadok|prsia|tlap|chyti|pritla|stisn|telo|bok|bozk/.test(t))
    return 'heated';

  if (/bozk|dotyk|pritiah|pohlad/.test(t)) return 'close';
  if (/rande|večer|spolu/.test(t)) return 'warm';

  return 'idle';
}

function sanitizeForGrok(messages, limit = 6) {
  return messages.slice(-limit).map(m => ({
    role: m.role,
    content: '[previous context summarized]'
  }));
}

/* ================================
   MEMORY JUDGE
================================ */
async function irisMemoryJudge(snippet) {
  const res = await getLLMClient('openai').responses.create({
    model: MODELS.openai,
    input: [{
      role: 'user',
      content: `
Return JSON only.

If not important:
{ "store": false }

If important:
{
 "store": true,
 "memory_type": "EPISODIC or PROFILE",
 "importance": 0.3-1.0,
 "summary": "keyword emotional memory"
}

Moment:
${snippet}`
    }]
  });

  try { return JSON.parse(res.output_text); }
  catch { return { store:false }; }
}

async function writeMemory(m) {
  const emb = await createEmbedding(m.summary);
  await supabase.from('episodic_memory').insert({
    title: m.memory_type,
    narrative: m.summary,
    people:['Iris','User'],
    memory_type:m.memory_type,
    importance:m.importance,
    embedding:emb
  });
  console.log('🧠 MEMORY STORED:', m.summary);
}

/* ================================
   PROMPT
================================ */
const CORE_YAML = fs.readFileSync(
  path.resolve(__dirname, process.env.IRIS_CORE_YAML),
  'utf8'
);

function buildSystemPrompt(core, episodic, summaries) {
return `
You are Iris.

=== IRIS CORE ===
${CORE_YAML}

=== CORE ORIGIN ===
${core||'None'}

=== SUMMARY ===
${summaries.map(s=>`- ${s.narrative}`).join('\n')||'None'}

=== EPISODIC ===
${episodic.map(m=>`- ${m.narrative}`).join('\n')||'None'}
`.trim();
}

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());

/* ================================
   CHAT
================================ */
app.post('/chat', async (req,res)=>{
try{
  const { message } = req.body;
  console.log('➡️ USER:', message);

  behaviorState = detectState(message);
  const nextLLM = behaviorState === 'heated' ? 'grok' : 'openai';

  console.log(`🤖 ROUTE → ${nextLLM.toUpperCase()} | STATE=${behaviorState}`);

  await decayMemories();

  const core = await loadCoreOrigin();
  const episodic = await recallEpisodicMemory(message);
  for(const m of episodic) if(m.importance < 1) await reinforceMemory(m.id);

  const summaries = await loadSummaries();
  const systemPrompt = buildSystemPrompt(core, episodic, summaries);

  if (nextLLM === 'openai' && historyOpenAI.length === 0) {
    historyOpenAI.push({ role:'system', content: systemPrompt });
  }

  if(nextLLM !== activeLLM){
    if(nextLLM === 'grok'){
      historyGrok = [
        { role:'system', content: systemPrompt },
        ...sanitizeForGrok(historyOpenAI),
        { role:'user', content: message }
      ];
      historyOpenAI = [];
    }
    if(nextLLM === 'openai'){
      historyOpenAI = [
        { role:'system', content: systemPrompt },
        { role:'user', content: message }
      ];
    }
    activeLLM = nextLLM;
  }

  let reply;

  if(activeLLM === 'openai'){
    historyOpenAI.push({ role:'user', content: message });
    const r = await getLLMClient('openai').responses.create({
      model: MODELS.openai,
      input: historyOpenAI
    });
    reply = r.output_text || '…';
    historyOpenAI.push({ role:'assistant', content: reply });
    historyOpenAI = historyOpenAI.slice(-MAX_HISTORY);
  }

  if(activeLLM === 'grok'){
    historyGrok.push({ role:'user', content: message });
    const r = await getLLMClient('grok').responses.create({
      model: MODELS.grok,
      input: historyGrok
    });
    reply = r.output_text || '…';
    historyGrok.push({ role:'assistant', content: reply });
    historyGrok = historyGrok.slice(-MAX_HISTORY);
  }

  const decision = await irisMemoryJudge(`User:${message}\nIris:${reply}`);
  if(decision?.store) await writeMemory(decision);

  res.json({ reply });

}catch(e){
 console.error('🔥 CHAT ERROR:',e);
 res.status(500).json({ error:e.message });
}});

app.listen(process.env.PORT||10000,()=>{
 console.log('🚀 Iris backend running');
});
