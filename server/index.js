import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';

import { detectState } from './behavior/state.js';
import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';
import { history } from './llm/history.js';

import { extractContextFromText } from './memory/contextJudge.js';
import { applySubjectLock } from './memory/subjectLock.js';

import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext,
} from './memory/sceneContext.js';

import { getSceneFacts } from './memory/sceneFacts.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory,
} from './memory/recall.js';

// ✅ NEW: robust multilingual intent judge for routing
import { intentJudgeLLM } from './behavior/intentJudge.js';

// 🔔 REMINDERS

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

// =======================================================
// AUTH
// =======================================================
async function requireUserId(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ error: 'NO TOKEN' });
    return null;
  }

  const {
    data: { user },
    error,
  } = await req.supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'INVALID USER' });
    return null;
  }

  return user.id;
}

// =======================================================
// CHAT
// =======================================================
app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    const sceneKey = 'global';

    console.log('[CHAT]', {
      userId,
      sceneKey,
      msg: message.slice(0, 160),
    });

    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // ------------------------------
    // CONTEXT JUDGES
    // ------------------------------
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {},
    });

    if (sccPatch && Object.keys(sccPatch).length) {
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    const subjectResult = applySubjectLock(message, sceneContext || {});
    if (
      subjectResult?.subject &&
      subjectResult.subject !== sceneContext?.last_subject
    ) {
      await patchSceneContext(req.supabase, sceneKey, {
        last_subject: subjectResult.subject,
      });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // ------------------------------
    // PROMPT BUILD
    // ------------------------------
    await getSceneFacts(req.supabase, userId, sceneKey, 'global');

    let systemPrompt = [
      formatSceneContextBlock(sceneContext),
      formatHardSceneContextBlock(sceneContext),
    ]
      .filter(Boolean)
      .join('\n\n');

    const coreOrigin = await loadCoreOrigin(req.supabase);
    const summaries = await loadSummaries(req.supabase);

    systemPrompt +=
      '\n\n' +
      buildSystemPrompt(
        coreOrigin ? [{ narrative: coreOrigin }] : [],
        summaries || [],
        []
      );

    const recall = await recallEpisodicMemory(req.supabase, message);
    if (recall?.meta?.confident && recall.memories?.length) {
      systemPrompt +=
        '\n\nEPISODIC_MEMORY:\n' +
        recall.memories
          .slice(0, 4)
          .map((m) => `- ${m.narrative}`)
          .join('\n');
    }

    // ------------------------------
    // LLM ROUTING (intent-based + engine lock)
    // ------------------------------
    const state = detectState(message);

    const intent = await intentJudgeLLM({
      text: message,
      sceneContext: sceneContext || {},
    });

    console.log('[INTENT]', {
      physicality: intent.physicality,
      intent: intent.intent,
      safety_level: intent.safety_level,
      body: intent.is_body_topic,
      romance: intent.is_romance_topic,
      erotic: intent.is_erotic_topic,
      confidence: intent.confidence,
    });

    const prevEngine = sceneContext?.last_engine || null;
    const prevLock = Number(sceneContext?.engine_lock_count || 0);

    // Trigger Grok for body/romance/erotic (with confidence gates)
    const triggersGrok =
      intent.is_erotic_topic ||
      intent.intent === 'erotic' ||
      intent.physicality === 'explicit' ||
      intent.safety_level === 'explicit' ||
      (intent.physicality === 'intimate' && intent.confidence >= 0.55) ||
      (intent.is_romance_topic && intent.confidence >= 0.65) ||
      // keep your old "heated" as an extra safety net
      state === 'heated';

    let engine = 'openai';
    let nextLock = 0;

    if (triggersGrok) {
      engine = 'grok';
      nextLock = 3; // keep Grok for next 2–3 messages
    } else if (prevEngine === 'grok' && prevLock > 0) {
      engine = 'grok';
      nextLock = prevLock - 1;
    } else {
      engine = 'openai';
      nextLock = 0;
    }

    console.log('[LLM_ROUTE]', {
      engine,
      state,
      prevEngine,
      prevLock,
      nextLock,
      sceneKey,
    });

    history.openai = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    const client = getLLMClient(engine);
    const model = MODELS[engine];

    const r = await client.responses.create({
      model,
      input: history.openai,
    });

    const reply = r.output_text || '…';

    console.log('[LLM_REPLY]', {
      engine,
      hasText: Boolean(reply),
    });

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine,
      engine_lock_count: nextLock,
      last_engine_reply: reply,
      interaction_mode: state,
    });

    return res.json({ reply });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    return res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running on port', process.env.PORT || 10000);
});