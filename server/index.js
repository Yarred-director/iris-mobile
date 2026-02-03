import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';

import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';
import { history } from './llm/history.js';

import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext
} from './memory/sceneContext.js';

import { extractContextFromText } from './memory/contextJudge.js';

// 🔥 ABSOLUTE PROOF THIS FILE IS RUNNING
console.log('🔥🔥🔥 INDEX VERSION: 2026-02-03 :: CONTEXT DEBUG HARD MODE 🔥🔥🔥');

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'NO TOKEN' });
    return null;
  }

  const { data: { user } } = await req.supabase.auth.getUser(token);
  if (!user) {
    res.status(401).json({ error: 'INVALID USER' });
    return null;
  }

  console.log('🔐 AUTH USER:', user.id);
  return user.id;
}

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('\n➡️ USER MESSAGE:', message);

    const userId = await requireUser(req, res);
    if (!userId) return;

    // === LOAD SCC ===
    let sceneContext = await getSceneContext(req.supabase, 'global');
    console.log('🧠 SCC BEFORE:', sceneContext);

    // === CONTEXT JUDGE (THIS MUST FIRE) ===
    console.log('🔥 CALLING extractContextFromText()');
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {}
    });
    console.log('🔥 extractContextFromText RESULT:', sccPatch);

    if (sccPatch && Object.keys(sccPatch).length > 0) {
      console.log('🧭 SCC PATCH APPLY:', sccPatch);
      await patchSceneContext(req.supabase, 'global', sccPatch);
      sceneContext = await getSceneContext(req.supabase, 'global');
      console.log('🧠 SCC AFTER PATCH:', sceneContext);
    }

    // === FORCE SAFETY NET (TEMPORARY) ===
    // If user clearly said "rano" and SCC still doesn't have it, force it
    if (
      /rano|ránko|dobre r[aá]no/i.test(message) &&
      !sceneContext?.time_of_day
    ) {
      console.log('⚠️ FORCE PATCH time_of_day=morning');
      await patchSceneContext(req.supabase, 'global', { time_of_day: 'morning' });
      sceneContext = await getSceneContext(req.supabase, 'global');
    }

    // === BUILD PROMPT ===
    let systemPrompt = buildSystemPrompt([], [], []);
    systemPrompt += formatSceneContextBlock(sceneContext);
    systemPrompt += formatHardSceneContextBlock(sceneContext);

    console.log('🧠 SYSTEM PROMPT:\n', systemPrompt);

    history.openai = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];

    const r = await getLLMClient('openai').responses.create({
      model: MODELS.openai,
      input: history.openai
    });

    const reply = r.output_text || '…';
    console.log('💬 REPLY:', reply);

    return res.json({ reply });

  } catch (e) {
    console.error('🔥 CHAT ERROR:', e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running on port', process.env.PORT || 10000);
});
