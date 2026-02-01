import cors from 'cors';
import express from 'express';
import './config/env.js';

import { getSceneFacts, upsertSceneFact } from './memory/sceneFacts.js';
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

import { inferRequestedFactKey } from './memory/factKeyJudge.js';
import { extractFactValue } from './memory/factValueJudge.js';
import { clearPendingFact, getPendingFact, setPendingFact } from './memory/pendingFacts.js';

import { hasPhysicalIntimacy } from './routing/physicalDetector.js';

// 🔥 NEW – Scene Context Core
import {
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext
} from './memory/sceneContext.js';

import { formatBridgeBlock } from './memory/bridge.js';
import { applySubjectLock } from './memory/subjectLock.js';

console.log('🔥 IRIS BOOTSTRAP OK — DUAL LLM + SCC ACTIVE');

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

    const state = detectState(message);
    await decayMemories();

    const core = await loadCoreOrigin();
    const { memories: episodic, meta: recallMeta } = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    const userId = req.userId;
    const sceneKey = detectSceneKey({ message, episodic });

    // 🧠 LOAD SCENE CONTEXT CORE
    const sceneContext = await getSceneContext(req.supabase, sceneKey);

    console.log(
      '🧠 SCC →',
      sceneContext?.interaction_mode,
      '| last_subject =',
      sceneContext?.last_subject
    );

    /* ============================
       SUBJECT LOCK
    ============================ */

    const { subject, augmentedText } =
      applySubjectLock(message, sceneContext);

    if (subject && subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, {
        last_subject: subject
      });
    }

    /* ============================
       PENDING FACT FLOW
    ============================ */

    const pendingKey = await getPendingFact(userId, sceneKey);

    if (pendingKey) {
      const { value, confidence } = await extractFactValue({
        factKey: pendingKey,
        userMessage: augmentedText
      });

      if (value && confidence >= 0.6) {
        await upsertSceneFact(userId, sceneKey, pendingKey, value, {
          confidence,
          source: 'user'
        });
        await clearPendingFact(userId, sceneKey);
      }
    }

    const sceneFacts = await getSceneFacts(userId, sceneKey);

    let requestedFactKey = null;
    if (!pendingKey) {
      requestedFactKey = await inferRequestedFactKey({
        message: augmentedText,
        sceneKey
      });

      if (requestedFactKey) {
        const exists = sceneFacts.some(f => f.fact_key === requestedFactKey);
        if (!exists) {
          await setPendingFact(userId, sceneKey, requestedFactKey);
        }
      }
    }

    for (const m of episodic) {
      if (typeof m.importance === 'number' && m.importance < 1) {
        await reinforceMemory(m.id);
      }
    }

    /* ============================
       SYSTEM PROMPT
    ============================ */

    let systemPrompt = buildSystemPrompt(core, episodic, summaries);

    // 🔥 SCENE CONTEXT CORE
    systemPrompt += formatSceneContextBlock(sceneContext);

    // 🔒 HARD FACTS
    if (sceneFacts.length > 0) {
      const factsText = sceneFacts
        .map(f => `- ${sceneKey}.${f.fact_key} = ${f.fact_value}`)
        .join('\n');

      systemPrompt += `

HARD FACTS:
${factsText}

RULES:
- Never invent missing attributes.
- Ask explicitly if a fact is missing.`;
    }

    if (!recallMeta?.confident && sceneFacts.length === 0) {
      systemPrompt += `

AIRBAG:
- Do not guess facts. Ask the user.`;
    }

    /* ============================
       PROVIDER ROUTING
    ============================ */

    let provider = 'openai';
    if (!message.toLowerCase().includes('spomien') && hasPhysicalIntimacy(message)) {
      provider = 'grok';
    }

    console.log(`🤖 STATE=${state} → ${provider}`);

    /* ============================
       BRIDGE (Grok → OpenAI)
    ============================ */

    if (provider === 'openai') {
      systemPrompt += formatBridgeBlock(sceneContext);
    }

    /* ============================
       HISTORY
    ============================ */

    if (provider === 'grok') {
      history.grok = [
        { role: 'system', content: systemPrompt },
        ...sanitizeForGrok(history.openai),
        { role: 'user', content: augmentedText }
      ];
      history.openai = [];
    }

    if (provider === 'openai') {
      history.openai = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: augmentedText }
      ];
    }

    const h = history[provider];

    const r = await getLLMClient(provider).responses.create({
      model: MODELS[provider],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(`💬 REPLY (${provider}):`, reply.slice(0, 80));

    /* ============================
       UPDATE SCENE CONTEXT
    ============================ */

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: provider,
      last_engine_reply: reply,
      interaction_mode: state
    });

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
