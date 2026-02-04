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

function formatSceneFactsBlock(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  return `
=== SCENE FACTS (HARD TRUTH) ===
${rows.map(r => `- ${r.fact_key}: ${r.fact_value}`).join('\n')}
`.trim();
}

const STRICT_FACT_GUARD = `
You MUST follow these rules strictly:
- You MUST NOT invent, guess, or assume facts.
- You may ONLY state facts that are explicitly present in SCENE FACTS or SCENE CONTEXT.
- If a fact is missing, you MUST say you do not know.
- You MUST NEVER replace or override stored facts.
Breaking these rules is a critical failure.
`.trim();

app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    const sceneKey = 'global';

    // 1️⃣ LOAD SCC
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // 2️⃣ PATCH SCC
    const sccPatch = extractContextFromText({ text: message, sceneContext });
    if (sccPatch && Object.keys(sccPatch).length) {
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // 3️⃣ SUBJECT LOCK
    const subjectResult = applySubjectLock(message, sceneContext);
    if (subjectResult?.subject && subjectResult.subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subjectResult.subject });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // 4️⃣ AUTO UPSERT FACTS
    const extractedFacts = extractFactsFromText({ text: message, sceneContext });
    if (Array.isArray(extractedFacts)) {
      for (const f of extractedFacts) {
        await upsertSceneFact(req.supabase, userId, sceneKey, f.fact_key, f.fact_value);
      }
    }

    // 5️⃣ LOAD HARD FACTS
    const sceneFacts = await getSceneFacts(req.supabase, userId, sceneKey);

    // 6️⃣ BUILD SYSTEM PROMPT (HARD FIRST)
    let systemPrompt = `
${STRICT_FACT_GUARD}

${formatSceneFactsBlock(sceneFacts)}

${formatSceneContextBlock(sceneContext)}
${formatHardSceneContextBlock(sceneContext)}
`.trim();

    // 7️⃣ ADD PERSONA + MEMORY (LOWER PRIORITY)
    const coreOrigin = await loadCoreOrigin(req.supabase);
    const summaries = await loadSummaries(req.supabase);

    systemPrompt += '\n\n' + buildSystemPrompt(
      coreOrigin ? [{ narrative: coreOrigin }] : [],
      summaries || [],
      []
    );

    // 8️⃣ EPISODIC (ONLY IF CONFIDENT)
    const recall = await recallEpisodicMemory(req.supabase, message);
    if (recall?.meta?.confident) {
      systemPrompt += `
=== EPISODIC MEMORY ===
${recall.memories.slice(0, 4).map(m => `- ${m.narrative}`).join('\n')}
`.trim();
    }

    // 9️⃣ LLM
    const state = detectState(message);
    const engine = state === 'heated' ? 'grok' : 'openai';

    history.openai = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    const client = getLLMClient(engine);
    const model = MODELS[engine];

    const r = await client.responses.create({ model, input: history.openai });
    const reply = r.output_text || '…';

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine,
      last_engine_reply: reply,
      interaction_mode: state,
    });

    res.json({ reply });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 IRIS backend running');
});
