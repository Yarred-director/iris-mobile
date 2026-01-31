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

import { history, sanitizeForGrok } from './llm/history.js';

// 🔥 NEW
import { hasPhysicalIntimacy } from './routing/physicalDetector.js';

console.log('🔥 IRIS BOOTSTRAP OK — DUAL LLM ACTIVE');

const app = express();
app.use(cors());
app.use(express.json());

/* ================================
   CHAT
================================ */

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('\n➡️ USER:', message);

    // FSM len pre tón
    const state = detectState(message);

    await decayMemories();

    const core = await loadCoreOrigin();
    const { memories: episodic, meta: recallMeta } = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    for (const m of episodic) {
      // len ak to pole existuje (v2)
      if (typeof m.importance === 'number' && m.importance < 1) {
        await reinforceMemory(m.id);
      }
    }

    // ✅ SYSTEM PROMPT JE TOTO (string)
    let systemPrompt = buildSystemPrompt(core, episodic, summaries);

    // ✅ CONFIDENCE GATE: keď recall nie je istý, zakáž vymýšľanie faktov
    if (!recallMeta?.confident) {
      systemPrompt += `

IMPORTANT:
- If you are not sure about factual details from memory, do NOT invent specifics.
- Say you don't have that information stored, or ask a clarifying question.
- Do not guess model names, dates, locations, parking spots, or other concrete details.`;
    }

    /* ============================
       🔥 PROVIDER ROUTING
    ============================ */

    let provider = 'openai';

    // MEMORY → vždy OpenAI
    const isMemory = message.toLowerCase().includes('spomien');

    if (!isMemory) {
      if (hasPhysicalIntimacy(message)) {
        provider = 'grok';
      }
    }

    console.log(`🤖 STATE=${state} → ${provider}`);

    /* ============================
       🔁 HISTORY BRIDGE
    ============================ */

    if (provider === 'grok') {
      history.grok = [
        { role: 'system', content: systemPrompt },
        ...sanitizeForGrok(history.openai),
        { role: 'user', content: message }
      ];
      history.openai = [];
    }

    if (provider === 'openai') {
      history.openai = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ];
    }

    // ❌ TOTO ODSTRÁNIME:
    // const h = history[provider];
    // h.push({ role: 'user', content: message });

    const h = history[provider];

    console.log(`🚀 CALL ${provider}`);

    const r = await getLLMClient(provider).responses.create({
      model: MODELS[provider],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(`💬 REPLY (${provider}):`, reply.slice(0, 80));

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
