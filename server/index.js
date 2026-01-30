/* ======================================================
   🔥 IRIS BACKEND — PRODUCTION INDEX
   DUAL LLM ROUTING + MEMORY + HARD LOGGING
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

import { history, sanitizeForGrok } from './llm/history.js';

console.log('🔥 IRIS BOOTSTRAP OK — DUAL LLM ACTIVE');

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());

let activeLLM = 'openai';

/* ================================
   CHAT ENDPOINT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    /* ----------------------------
       INPUT
    ----------------------------- */
    console.log('\n➡️ USER MESSAGE:', message);

    /* ----------------------------
       BEHAVIOR + ROUTING
    ----------------------------- */
    const state = detectState(message);
    const nextLLM = state === 'heated' ? 'grok' : 'openai';

    console.log(`🤖 STATE=${state} → NEXT_LLM=${nextLLM.toUpperCase()}`);

    /* ----------------------------
       MEMORY DECAY (GLOBAL)
    ----------------------------- */
    await decayMemories();

    /* ----------------------------
       MEMORY RECALL
    ----------------------------- */
    const core = await loadCoreOrigin();
    const episodic = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    console.log(
      '🧠 EPISODIC:',
      episodic.map(m => ({
        id: m.id,
        importance: m.importance,
        narrative: m.narrative.slice(0, 80)
      }))
    );

    console.log(
      '📜 SUMMARIES:',
      summaries.map(s => s.narrative.slice(0, 80))
    );

    /* ----------------------------
       MEMORY REINFORCEMENT
    ----------------------------- */
    for (const m of episodic) {
      if (m.importance < 1) {
        await reinforceMemory(m.id);
      }
    }

    /* ----------------------------
       SYSTEM PROMPT
    ----------------------------- */
    const systemPrompt = buildSystemPrompt(core, episodic, summaries);

    /* ----------------------------
       LLM SWITCHING
    ----------------------------- */
    if (nextLLM !== activeLLM) {
      console.log(`🔁 SWITCH ${activeLLM.toUpperCase()} → ${nextLLM.toUpperCase()}`);

      if (nextLLM === 'grok') {
        history.grok = [
          { role: 'system', content: systemPrompt },
          ...sanitizeForGrok(history.openai),
          { role: 'user', content: message }
        ];
        history.openai = []; // 🔒 erotic isolation
      }

      if (nextLLM === 'openai') {
        history.openai = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ];
      }

      activeLLM = nextLLM;
    }

    /* ----------------------------
       🛡️ CRITICAL SYSTEM GUARD
    ----------------------------- */
    if (activeLLM === 'openai') {
      const hasSystem = history.openai.some(m => m.role === 'system');
      if (!hasSystem) {
        console.log('🛡️ SYSTEM PROMPT RE-INJECTED (OpenAI)');
        history.openai.unshift({ role: 'system', content: systemPrompt });
      }
    }

    console.log(
      '📜 HISTORY ROLES:',
      history[activeLLM].map(m => m.role)
    );

    // ❌ HARD FAIL — radšej crash než fake Iris
    if (
      activeLLM === 'openai' &&
      !history.openai.some(m => m.role === 'system')
    ) {
      throw new Error('SYSTEM PROMPT MISSING — REFUSING TO ANSWER');
    }

    /* ----------------------------
       LLM CALL
    ----------------------------- */
    const h = history[activeLLM];
    h.push({ role: 'user', content: message });

    console.log(`🚀 CALLING ${activeLLM.toUpperCase()}`);

    const r = await getLLMClient(activeLLM).responses.create({
      model: MODELS[activeLLM],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(
      `💬 REPLY FROM ${activeLLM.toUpperCase()}:`,
      reply.slice(0, 120)
    );

    /* ----------------------------
       MEMORY JUDGE
    ----------------------------- */
    const decision = await irisMemoryJudge(
      `User:${message}\nIris:${reply}`
    );

    if (decision?.store) {
      await writeMemory(decision);
    }

    /* ----------------------------
       RESPONSE
    ----------------------------- */
    res.json({ reply });

  } catch (e) {
    console.error('🔥 CHAT ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ================================
   START
================================ */
app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running');
});
