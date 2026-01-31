import './config/env.js';

import cors from 'cors';
import express from 'express';

import { getSceneFacts } from './memory/sceneFacts.js';
import { sessionMiddleware } from './middleware/session.js';
import { detectSceneKey } from './routing/sceneDetector.js';

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
app.use(sessionMiddleware);

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

    // 🔐 user & scene (NO HARDCODE)
    const userId = req.userId;
    const sceneKey = detectSceneKey({ message, episodic });

    const sceneFacts = await getSceneFacts(userId, sceneKey);

    // reinforcement
    for (const m of episodic) {
      if (typeof m.importance === 'number' && m.importance < 1) {
        await reinforceMemory(m.id);
      }
    }

    // 🧠 SYSTEM PROMPT
    let systemPrompt = buildSystemPrompt(core, episodic, summaries);

    // 🔒 HARD FACTS (scene_facts have priority)
    if (sceneFacts.length > 0) {
      const factsText = sceneFacts
        .map(f => `- ${sceneKey}.${f.fact_key} = ${f.fact_value}`)
        .join('\n');

      systemPrompt += `

HARD FACTS (must be treated as true):
${factsText}

Rules:
- Use HARD FACTS verbatim when the user asks about them.
- If a needed fact is missing, say you don't know and ask the user.
- Do NOT invent specific factual details.`;
    }

    // 🛟 AIRBAG – len ak NIE SÚ facts
    if (!recallMeta?.confident && sceneFacts.length === 0) {
      systemPrompt += `

IMPORTANT:
- If you are not sure about factual details, do NOT invent specifics.
- Say you don't have that detail stored and ask the user.`;
    }

    /* ============================
       🔥 PROVIDER ROUTING
    ============================ */

    let provider = 'openai';

    // MEMORY → vždy OpenAI
    const isMemory = message.toLowerCase().includes('spomien');

    if (!isMemory && hasPhysicalIntimacy(message)) {
      provider = 'grok';
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
