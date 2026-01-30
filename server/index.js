import './config/env.js';

import cors from 'cors';
import express from 'express';

import { detectState } from './behavior/state.js';
import { irisMemoryJudge, writeMemory } from './memory/judge.js';
import { loadCoreOrigin, loadSummaries, recallEpisodicMemory } from './memory/recall.js';
import { decayMemories, reinforceMemory } from './memory/reinforce.js';
import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';
import { history, sanitizeForGrok } from './llm/history.js';

console.log('🔥 IRIS BOOTSTRAP OK');

const app = express();
app.use(cors());
app.use(express.json());

let activeLLM = 'openai';

app.post('/chat', async (req,res)=>{
try{
  const { message } = req.body;

  const state = detectState(message);
  const nextLLM = state === 'heated' ? 'grok' : 'openai';

  await decayMemories();

  const core = await loadCoreOrigin();
  const episodic = await recallEpisodicMemory(message);
  for (const m of episodic) if (m.importance < 1) await reinforceMemory(m.id);

  const summaries = await loadSummaries();
  const systemPrompt = buildSystemPrompt(core, episodic, summaries);

  if (nextLLM !== activeLLM) {
    if (nextLLM === 'grok') {
      history.grok = [
        { role:'system', content: systemPrompt },
        ...sanitizeForGrok(history.openai),
        { role:'user', content: message }
      ];
      history.openai = [];
    }
    if (nextLLM === 'openai') {
      history.openai = [
        { role:'system', content: systemPrompt },
        { role:'user', content: message }
      ];
    }
    activeLLM = nextLLM;
  }

  const h = history[activeLLM];
  h.push({ role:'user', content: message });

  const r = await getLLMClient(activeLLM).responses.create({
    model: MODELS[activeLLM],
    input: h
  });

  const reply = r.output_text || '…';
  h.push({ role:'assistant', content: reply });

  const decision = await irisMemoryJudge(`User:${message}\nIris:${reply}`);
  if (decision?.store) await writeMemory(decision);

  res.json({ reply });

}catch(e){
  console.error(e);
  res.status(500).json({ error:e.message });
}});

app.listen(process.env.PORT||10000,()=>{
  console.log('🚀 Iris backend running');
});
