import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';

import { detectState } from './behavior/state.js';
import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';
import { history } from './llm/history.js';

import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext,
} from './memory/sceneContext.js';

import { extractContextFromText } from './memory/contextJudge.js';
import { applySubjectLock } from './memory/subjectLock.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory,
} from './memory/recall.js';

import { extractFactsFromText } from './memory/factExtractor.js';
import { getSceneFacts, upsertSceneFact } from './memory/sceneFacts.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

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

function formatEpisodicBlock(recallResult) {
  const memories = recallResult?.memories || [];
  if (!memories.length) return '';

  const lines = memories
    .slice(0, 4)
    .map((m) => {
      const text = (m.narrative || m.title || '').toString().trim();
      return text ? `- ${text}` : null;
    })
    .filter(Boolean);

  if (!lines.length) return '';

  return `
=== EPISODIC MEMORY ===
${lines.join('\n')}
`.trim();
}

function formatSceneFactsBlock(sceneFactsRows) {
  const rows = Array.isArray(sceneFactsRows) ? sceneFactsRows : [];
  if (!rows.length) return '';

  // rows expected shape: [{ fact_key, fact_value }, ...]
  const lines = rows
    .map((r) => {
      const k = (r.fact_key || '').toString().trim();
      const v = (r.fact_value || '').toString().trim();
      if (!k || !v) return null;
      return `- ${k}: ${v}`;
    })
    .filter(Boolean);

  if (!lines.length) return '';

  return `
=== SCENE FACTS (HARD) ===
${lines.join('\n')}
`.trim();
}

app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    const sceneKey = 'global'; // stable single SCC key (clamped in sceneContext.js)

    // 1️⃣ Load stable GLOBAL SCC
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // 2️⃣ Deterministic context judge (SCC patch)
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {},
    });

    if (sccPatch && Object.keys(sccPatch).length > 0) {
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // 3️⃣ Subject lock
    const subjectResult = applySubjectLock(message, sceneContext);
    if (
      subjectResult?.subject &&
      subjectResult.subject !== sceneContext?.last_subject
    ) {
      await patchSceneContext(req.supabase, sceneKey, {
        last_subject: subjectResult.subject,
      });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // 4️⃣ AUTO-UPSERT FACTS (deterministic)
    //    This prevents "Challenger overwrites Skyline" by using scoped fact keys like car.dubai.* vs car.tokyo.*
    const extractedFacts = extractFactsFromText({
      text: message,
      sceneContext: sceneContext || {},
    });

    if (Array.isArray(extractedFacts) && extractedFacts.length) {
      for (const f of extractedFacts) {
        const factKey = f?.fact_key;
        const factValue = f?.fact_value;
        if (!factKey || !factValue) continue;

        await upsertSceneFact(req.supabase, userId, sceneKey, factKey, factValue);
      }
    }

    // 5️⃣ Behavior state (SAFE INPUT)
    const state = detectState(message);
    const engine = state === 'heated' ? 'grok' : 'openai';

    // 6️⃣ Episodic recall (user-scoped)
    let recallResult = null;
    try {
      recallResult = await recallEpisodicMemory(req.supabase, message);
    } catch {
      recallResult = { memories: [], meta: { confident: false } };
    }

    const episodicBlock =
      recallResult?.meta?.confident
        ? formatEpisodicBlock(recallResult)
        : '';

    // 7️⃣ Core + summaries (user-scoped)
    let coreOrigin = null;
    let summaries = [];
    try {
      coreOrigin = await loadCoreOrigin(req.supabase);
      summaries = await loadSummaries(req.supabase);
    } catch {}

    // 8️⃣ Build system prompt
    let systemPrompt = buildSystemPrompt(
      coreOrigin ? [{ narrative: coreOrigin }] : [],
      summaries || [],
      []
    );

    // 9️⃣ Inject SCC blocks
    systemPrompt += '\n\n' + formatSceneContextBlock(sceneContext);
    systemPrompt += '\n\n' + formatHardSceneContextBlock(sceneContext);

    // 🔟 Inject SCENE FACTS (HARD)
    const sceneFacts = await getSceneFacts(req.supabase, userId, sceneKey);
    const sceneFactsBlock = formatSceneFactsBlock(sceneFacts);
    if (sceneFactsBlock) {
      systemPrompt += '\n\n' + sceneFactsBlock;
    }

    // 1️⃣1️⃣ Inject EPISODIC (only if confident)
    if (episodicBlock) {
      systemPrompt += '\n\n' + episodicBlock;
    }

    // 1️⃣2️⃣ History
    const userText = subjectResult?.augmentedText || message;

    history.openai = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ];

    // 1️⃣3️⃣ LLM call
    const client = getLLMClient(engine);
    const model = MODELS[engine];

    const r = await client.responses.create({
      model,
      input: history.openai,
    });

    const reply = r.output_text || '…';

    // 1️⃣4️⃣ Persist interaction to SCC
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine,
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
