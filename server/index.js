import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';

import { hasPhysicalIntimacy } from './routing/physicalDetector.js';
import { detectSceneKey } from './routing/sceneDetector.js';

import { detectState } from './behavior/state.js';
import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';
import { history, sanitizeForGrok } from './llm/history.js';

import { formatBridgeBlock } from './memory/bridge.js';
import { applySubjectLock } from './memory/subjectLock.js';

import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext
} from './memory/sceneContext.js';

import { extractContextFromText } from './memory/contextJudge.js';

import { inferRequestedFactKey } from './memory/factKeyJudge.js';
import { extractFactValue } from './memory/factValueJudge.js';
import { clearPendingFact, getPendingFact, setPendingFact } from './memory/pendingFacts.js';
import { getSceneFacts, upsertSceneFact } from './memory/sceneFacts.js';

import { irisMemoryJudge, writeMemory } from './memory/judge.js';
import { loadCoreOrigin, loadSummaries, recallEpisodicMemory } from './memory/recall.js';
import { decayMemories, reinforceMemory } from './memory/reinforce.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

async function requireStableUserId(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Missing Authorization Bearer token' });
    return null;
  }

  const { data: { user }, error } = await req.supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }

  return user.id; // ✅ stable UUID
}

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    console.log('\n➡️ USER:', message);

    // ✅ stable auth identity (NO anon fallback)
    const userId = await requireStableUserId(req, res);
    if (!userId) return;
    console.log('🔐 AUTH USER:', userId);

    // (optional) decay — you can later move this to cron
    // If you want it OFF for now, comment it out.
    await decayMemories();

    // 1) recall stack
    const core = await loadCoreOrigin();
    const { memories: episodic, meta: recallMeta } = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    // 2) sceneKey
    const sceneKey = detectSceneKey({ message, episodic });

    // 3) load SCC
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    console.log(
      '🧠 SCC →',
      sceneContext
        ? `mode=${sceneContext.interaction_mode}, subject=${sceneContext.last_subject}, last_engine=${sceneContext.last_engine}`
        : 'EMPTY (first message)'
    );

    // 4) deterministic explicit context capture (NO guessing)
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {}
    }) || null;

    if (sccPatch && Object.keys(sccPatch).length > 0) {
      console.log('🧭 SCC PATCH →', sccPatch);
      await patchSceneContext(req.supabase, sceneKey, sccPatch);

      // refresh merged in-memory copy for prompt building
      sceneContext = {
        ...(sceneContext || {}),
        ...sccPatch
      };
    }

    // 5) subject lock (working memory)
    const { subject, augmentedText } = applySubjectLock(message, sceneContext || {});

    if (subject && subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subject });
      if (sceneContext) sceneContext.last_subject = subject;
    }

    // 6) pending facts flow
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

    if (!pendingKey) {
      const requestedFactKey = await inferRequestedFactKey({
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

    // 7) reinforce recalled memories (safe but can be async later)
    for (const m of episodic || []) {
      if (m?.id) {
        // keep it non-fatal
        reinforceMemory(m.id).catch(() => {});
      }
    }

    // 8) build system prompt
    let systemPrompt = buildSystemPrompt(core, episodic, summaries);

    systemPrompt += formatSceneContextBlock(sceneContext);
    systemPrompt += formatHardSceneContextBlock(sceneContext);

    // facts injection + strict guard
    if (sceneFacts && sceneFacts.length > 0) {
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

    // airbag when no confident recall and no facts
    if (!recallMeta?.confident && (!sceneFacts || sceneFacts.length === 0)) {
      systemPrompt += `

AIRBAG:
- Do not guess facts. Ask the user.`;
    }

    // 9) provider routing
    const state = detectState(message);
    let provider = 'openai';

    if (hasPhysicalIntimacy(message)) provider = 'grok';

    console.log(`🤖 STATE=${state} → ${provider}`);

    // 10) bridge injection (Grok → OpenAI continuity)
    if (provider === 'openai') {
      systemPrompt += formatBridgeBlock(sceneContext);
    }

    // 11) history packaging
    if (provider === 'grok') {
      history.grok = [
        { role: 'system', content: systemPrompt },
        ...sanitizeForGrok(history.openai),
        { role: 'user', content: augmentedText }
      ];
      history.openai = [];
    } else {
      history.openai = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: augmentedText }
      ];
    }

    const h = history[provider];

    // 12) LLM call
    const r = await getLLMClient(provider).responses.create({
      model: MODELS[provider],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(`💬 REPLY (${provider}):`, reply.slice(0, 160));

    // 13) update SCC after reply
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: provider,
      last_engine_reply: reply,
      interaction_mode: state
    });

    // ✅ store bridge_buffer on grok replies
    if (provider === 'grok') {
      await patchSceneContext(req.supabase, sceneKey, {
        bridge_buffer: [
          { role: 'user', content: augmentedText },
          { role: 'assistant', content: reply }
        ]
      });
    }

    // 14) memory judge (store meaningful moments)
    // Make non-fatal. If judge fails, chat still works.
    irisMemoryJudge(`User:${message}\nIris:${reply}`)
      .then(async (decision) => {
        if (decision?.store) {
          await writeMemory(decision);
        }
      })
      .catch(() => {});

    return res.json({ reply, engine: provider });

  } catch (e) {
    console.error('🔥 CHAT ERROR:', e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running');
});
