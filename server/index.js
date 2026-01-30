/* ======================================================
   🔥 IRIS BACKEND — PRODUCTION INDEX (FIXED)
====================================================== */

import './config/env.js';

import cors from 'cors';
import express from 'express';

import { detectState } from './behavior/state.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory
} from './memory/recall.js';

import {
  decayMemories,
  reinforceMemory
} from './memory/reinforce.js';

import {
  irisMemoryJudge,
  writeMemory
} from './memory/judge.js';

import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';

import { supabase } from './config/supabase.js';
import { history, sanitizeForGrok } from './llm/history.js';

console.log('🔥 IRIS BOOTSTRAP OK — DUAL LLM ACTIVE');

/* ================================ */
const app = express();
app.use(cors());
app.use(express.json());

let activeLLM = 'openai';

/* ================================
   UI ENDPOINTS
================================ */

app.get('/ui/splash', async (_, res) => {
  const { data } = await supabase
    .from('ui_config')
    .select('image_url, overlay, blur')
    .eq('key', 'splash_loading')
    .single();
  console.log('🖼️ SPLASH CONFIG:', data || 'NONE');
  res.json(data || null);
});

app.get('/ui/chat-background', async (_, res) => {
  const { data } = await supabase
    .from('ui_config')
    .select('image_url, overlay, blur')
    .eq('key', 'chat_background')
    .single();
  console.log('🖼️ BACKGROUND CONFIG:', data || 'NONE');
  res.json(data || null);
});

app.get('/api/avatar/current', async (_, res) => {
  const { data } = await supabase
    .from('avatars')
    .select('image_url, variant')
    .eq('is_active', true)
    .single();
  console.log('👤 AVATAR:', data || 'NONE');
  res.json(data || null);
});

/* ================================
   CHAT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('\n➡️ USER:', message);

    const state = detectState(message);
    const nextLLM = state === 'heated' ? 'grok' : 'openai';
    console.log(`🤖 STATE=${state} → ${nextLLM}`);

    await decayMemories();

    const core = await loadCoreOrigin();
    const episodic = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    for (const m of episodic) {
      if (m.importance < 1) await reinforceMemory(m.id);
    }

    const systemPrompt = buildSystemPrompt(core, episodic, summaries);

    /* 🔁 LLM SWITCH */
    if (nextLLM !== activeLLM) {
      console.log(`🔁 SWITCH ${activeLLM} → ${nextLLM}`);

      if (nextLLM === 'grok') {
        history.grok = [
          { role: 'system', content: systemPrompt },
          ...sanitizeForGrok(history.openai),
          { role: 'user', content: message }
        ];
        history.openai = [];
      }

      if (nextLLM === 'openai') {
        history.openai = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ];
      }

      activeLLM = nextLLM;
    }

    /* 🛡️ GUARANTEE SYSTEM PROMPT (FIX) */
    if (activeLLM === 'openai') {
      const hasSystem = history.openai.some(m => m.role === 'system');
      if (!hasSystem) {
        console.log('🛡️ SYSTEM PROMPT AUTO-INJECTED');
        history.openai.unshift({ role: 'system', content: systemPrompt });
      }
    }

    const h = history[activeLLM];
    h.push({ role: 'user', content: message });

    console.log(`🚀 CALL ${activeLLM}`);

    const r = await getLLMClient(activeLLM).responses.create({
      model: MODELS[activeLLM],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(`💬 REPLY (${activeLLM}):`, reply.slice(0, 80));

    const decision = await irisMemoryJudge(`User:${message}\nIris:${reply}`);
    if (decision?.store) await writeMemory(decision);

    res.json({ reply });

  } catch (e) {
    console.error('🔥 CHAT ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () =>
  console.log('🚀 Iris backend running')
);
