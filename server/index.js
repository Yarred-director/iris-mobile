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

// ------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

function inferTimeOfDayFromText(text = '') {
  const t = (text || '').toLowerCase();
  if (/\br[aá]no\b|\bjutro\b|\bdobre r[aá]no\b/.test(t)) return 'morning';
  if (/\bobed\b|\bpoobede\b|\bpopoludn[ií]\b/.test(t)) return 'afternoon';
  if (/\bve[čc]er\b|\bdobr[ýy] ve[čc]er\b/.test(t)) return 'evening';
  if (/\bnoc\b|\bpolnoc\b|\bdobr[úu] noc\b/.test(t)) return 'night';

  if (/\bmorning\b/.test(t)) return 'morning';
  if (/\bafternoon\b/.test(t)) return 'afternoon';
  if (/\bevening\b/.test(t)) return 'evening';
  if (/\bnight\b|\bmidnight\b/.test(t)) return 'night';
  return null;
}

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

// ------------------------------------------------------------

app.get('/', (_req, res) => res.send('IRIS backend running'));

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    console.log('\n➡️ USER:', message);

    // ✅ STABLE USER (NO anon fallback)
    const userId = await requireStableUserId(req, res);
    if (!userId) return;

    // (optional debug)
    console.log('🔐 AUTH USER:', userId);

    // scene key + SCC load
    const sceneKey = detectSceneKey({ message, episodic: [] });
    const sceneContext = await getSceneContext(req.supabase, sceneKey);

    // deterministic explicit context capture (NO guessing)
    const sccPatch = extractContextFromText({ text: message, sceneContext: sceneContext || {} }) || {};

    // allow time_of_day only if SCC empty (avoid overwrites)
    if (!sccPatch.time_of_day && !(sceneContext && sceneContext.time_of_day)) {
      const tod = inferTimeOfDayFromText(message);
      if (tod) sccPatch.time_of_day = tod;
    }

    let merged = sceneContext;
    if (Object.keys(sccPatch).length > 0) {
      console.log('🧭 SCC PATCH →', sccPatch);
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      merged = { ...(sceneContext || {}), ...sccPatch };
    }

    // subject lock
    const { augmentedText, subject } = applySubjectLock(message, merged || {});
    if (subject && subject !== merged?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subject });
      if (merged) merged.last_subject = subject;
    }

    // build system prompt
    let systemPrompt = buildSystemPrompt(
      /* core */ null,
      /* episodic */ [],
      /* summaries */ []
    );

    systemPrompt += formatSceneContextBlock(merged);
    systemPrompt += formatHardSceneContextBlock(merged);

    // provider routing
    const state = detectState(message);
    let provider = 'openai';
    if (hasPhysicalIntimacy(message)) provider = 'grok';

    console.log(`🤖 STATE=${state} → ${provider}`);

    // inject bridge into OpenAI prompt (so it can continue after Grok)
    if (provider === 'openai') {
      systemPrompt += formatBridgeBlock(merged);
    }

    // history packaging
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

    // LLM call
    const r = await getLLMClient(provider).responses.create({
      model: MODELS[provider],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(`💬 REPLY (${provider}):`, reply.slice(0, 140));

    // update SCC after reply
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: provider,
      last_engine_reply: reply,
      interaction_mode: state
    });

    // ✅ bridge_buffer from Grok → OpenAI continuity
    if (provider === 'grok') {
      await patchSceneContext(req.supabase, sceneKey, {
        bridge_buffer: [
          { role: 'user', content: augmentedText },
          { role: 'assistant', content: reply }
        ]
      });
    }

    return res.json({ reply, engine: provider });

  } catch (e) {
    console.error('🔥 CHAT ERROR:', e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running');
});
