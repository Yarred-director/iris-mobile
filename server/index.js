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

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

async function requireUserId(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'NO TOKEN' });
    return null;
  }

  const { data: { user }, error } = await req.supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'INVALID USER' });
    return null;
  }

  return user.id;
}

function formatEpisodicBlock(recallResult) {
  const memories = recallResult?.memories || [];
  if (!memories.length) return '';

  // Keep it short & punchy; model should not drown.
  const lines = memories.slice(0, 4).map((m) => {
    const text = (m.narrative || m.title || '').toString().trim();
    return text ? `- ${text}` : null;
  }).filter(Boolean);

  if (!lines.length) return '';

  return `

=== EPISODIC MEMORY (recall) ===
${lines.join('\n')}
`.trimEnd();
}

app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    // === 1) Load stable SCC (global) ===
    let sceneContext = await getSceneContext(req.supabase, 'global');

    // === 2) Deterministic contextJudge patch (time/place/room/city) ===
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {},
    });

    if (sccPatch) {
      await patchSceneContext(req.supabase, 'global', sccPatch);
      sceneContext = await getSceneContext(req.supabase, 'global');
    }

    // === 3) Subject lock (cars etc.) ===
    const subjectResult = applySubjectLock(message, sceneContext);
    if (subjectResult?.subject && subjectResult.subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, 'global', { last_subject: subjectResult.subject });
      sceneContext = await getSceneContext(req.supabase, 'global');
    }

    // === 4) Behavior state (engine selection etc.) ===
    const state = detectState({ userText: message, sceneContext });
    const engine = state?.engine || 'openai';

    // === 5) Memory recall (episodic) ===
    // We rely on your recall.js confidence gate. If not confident => inject nothing.
    let recallResult = null;
    try {
      recallResult = await recallEpisodicMemory(message);
    } catch (e) {
      recallResult = { memories: [], meta: { confident: false, reason: 'recall_exception' } };
    }

    const episodicBlock =
      recallResult?.meta?.confident ? formatEpisodicBlock(recallResult) : '';

    // Optional: core origin + summaries (if you want them; safe and short)
    let coreOrigin = null;
    let summaries = [];
    try {
      coreOrigin = await loadCoreOrigin();
      summaries = await loadSummaries();
    } catch {}

    // === 6) Build system prompt ===
    let systemPrompt = buildSystemPrompt(
      coreOrigin ? [{ narrative: coreOrigin }] : [],
      summaries || [],
      [] // (optional) profile facts, if you have them
    );

    systemPrompt += '\n\n' + formatSceneContextBlock(sceneContext);
    systemPrompt += '\n\n' + formatHardSceneContextBlock(sceneContext);

    if (episodicBlock) {
      systemPrompt += '\n\n' + episodicBlock;
    }

    // === 7) Compose chat history ===
    const userText = subjectResult?.augmentedText || message;

    history.openai = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ];

    // === 8) Call model ===
    const client = getLLMClient(engine);
    const model = MODELS[engine];

    const r = await client.responses.create({
      model,
      input: history.openai,
    });

    const reply = r.output_text || '…';

    // === 9) Store last engine + reply (helps continuity / debugging) ===
    await patchSceneContext(req.supabase, 'global', {
      last_engine: engine,
      last_engine_reply: reply,
      interaction_mode: state?.mode || sceneContext?.interaction_mode || 'idle',
    });

    return res.json({
      reply,
      // Optional debug: keep if your app ignores unknown fields.
      // engine,
      // recall: recallResult?.meta,
    });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    return res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running on port', process.env.PORT || 10000);
});
