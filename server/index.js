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
import { reinforceMemory } from './memory/reinforce.js';

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

  return user.id;
}

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const userId = await requireStableUserId(req, res);
    if (!userId) return;

    const core = await loadCoreOrigin();
    const { memories: episodic, meta: recallMeta } = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    const sceneKey = detectSceneKey({ message, episodic });
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // ✅ deterministic explicit context capture
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {}
    });

    if (sccPatch && Object.keys(sccPatch).length > 0) {
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      // 🔥 IMPORTANT: re-fetch SCC to keep _resolved
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // subject lock
    const { subject, augmentedText } = applySubjectLock(message, sceneContext || {});
    if (subject && subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subject });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // pending facts
    const pendingKey = await getPendingFact(userId, sceneKey);
    if (pendingKey) {
      const { value, confidence } = await extractFactValue({
        factKey: pendingKey,
        userMessage: augmentedText
      });

      if (value && confidence >= 0.6) {
        await upsertSceneFact(userId, sceneKey, pendingKey, value, { confidence });
        await clearPendingFact(userId, sceneKey);
      }
    }

    const sceneFacts = await getSceneFacts(userId, sceneKey);

    if (!pendingKey) {
      const requestedFactKey = await inferRequestedFactKey({
        message: augmentedText,
        sceneKey
      });

      if (requestedFactKey && !sceneFacts.some(f => f.fact_key === requestedFactKey)) {
        await setPendingFact(userId, sceneKey, requestedFactKey);
      }
    }

    for (const m of episodic || []) {
      if (m?.id) reinforceMemory(m.id).catch(() => {});
    }

    // 🔥 SYSTEM PROMPT (HARD CONTEXT LAST)
    let systemPrompt = buildSystemPrompt(core, episodic, summaries);

    systemPrompt += formatSceneContextBlock(sceneContext);

    if (sceneFacts.length > 0) {
      systemPrompt += `
HARD FACTS:
${sceneFacts.map(f => `- ${sceneKey}.${f.fact_key} = ${f.fact_value}`).join('\n')}
`;
    }

    // ⛔ HARD CONTEXT MUST BE LAST
    systemPrompt += formatHardSceneContextBlock(sceneContext);

    const state = detectState(message);
    let provider = hasPhysicalIntimacy(message) ? 'grok' : 'openai';

    if (provider === 'openai') {
      systemPrompt += formatBridgeBlock(sceneContext);
    }

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

    const r = await getLLMClient(provider).responses.create({
      model: MODELS[provider],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: provider,
      last_engine_reply: reply,
      interaction_mode: state
    });

    if (provider === 'grok') {
      await patchSceneContext(req.supabase, sceneKey, {
        bridge_buffer: [
          { role: 'user', content: augmentedText },
          { role: 'assistant', content: reply }
        ]
      });
    }

    irisMemoryJudge(`User:${message}\nIris:${reply}`)
      .then(d => d?.store && writeMemory(d))
      .catch(() => {});

    return res.json({ reply });

  } catch (e) {
    console.error('CHAT ERROR', e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running');
});
