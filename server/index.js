import cors from 'cors';
import express from 'express';
import './config/env.js';

import { detectState } from './behavior/state.js';
import { sessionMiddleware } from './middleware/session.js';
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

import { loadCoreOrigin, loadSummaries, recallEpisodicMemory } from './memory/recall.js';

import { factJudge } from './memory/factJudge.js';
import { getActiveFactSchema } from './memory/factSchema.js';
import { getSceneFacts, upsertSceneFact } from './memory/sceneFacts.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

function slugifyScope(s) {
  return (s || 'global')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'global';
}

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

function formatFactsBlock(rows, title) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const lines = rows
    .map(r => `- ${r.fact_key}: ${r.fact_value}`)
    .join('\n');
  return `=== ${title} ===\n${lines}`.trim();
}

const STRICT_FACT_GUARD = `
Truth rules (strict, but keep human vibe):
- DO NOT invent, guess, or assume facts.
- Only use facts explicitly present in SCENE FACTS and SCENE CONTEXT blocks.
- If a fact is missing, say you don't know warmly and ask ONE short follow-up question.
- Never override stored facts.
`.trim();

app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    const sceneKey = 'global';

    // LOG: request start
    console.log('[CHAT] userId=', userId, 'sceneKey=', sceneKey, 'msg=', message.slice(0, 160));

    // 1) SCC load + patch (deterministic, no guessing)
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    const sccPatch = extractContextFromText({ text: message, sceneContext: sceneContext || {} });
    if (sccPatch && Object.keys(sccPatch).length) {
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[SCC] patch=', sccPatch);
    }

    // 2) subject lock
    const subjectResult = applySubjectLock(message, sceneContext || {});
    if (subjectResult?.subject && subjectResult.subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subjectResult.subject });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[SCC] subject=', subjectResult.subject);
    }

    // 3) scope = derived from SCC only (DB truth), no hardcode mapping
    const scopeCandidate =
      sceneContext?.location_country ||
      sceneContext?.location_city ||
      sceneContext?.place ||
      'global';
    const scope = slugifyScope(scopeCandidate);

    console.log('[SCOPE] candidate=', scopeCandidate, '=>', scope);

    // 4) DB-driven schema + fact extraction
    const schema = await getActiveFactSchema(req.supabase);
    console.log('[FACT_SCHEMA] count=', schema.length);

    const extracted = await factJudge({ text: message, schema });
    console.log('[FACT_JUDGE] extracted=', extracted);

    // 5) upsert extracted facts into scene_facts (scoped)
    if (Array.isArray(extracted) && extracted.length) {
      for (const f of extracted) {
        const factKey = f.fact_key;
        const conf = typeof f.confidence === 'number' ? f.confidence : 0.9;

        // store as text, if object -> JSON stringify
        const rawValue = f.fact_value;
        const valueType =
          rawValue !== null && typeof rawValue === 'object' ? 'json' : typeof rawValue === 'number' ? 'number' : typeof rawValue === 'boolean' ? 'boolean' : 'text';
        const factValue =
          rawValue !== null && typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);

        const ok = await upsertSceneFact(
          req.supabase,
          userId,
          sceneKey,
          scope,
          factKey,
          factValue,
          valueType,
          conf,
          'user'
        );

        console.log('[FACT_UPSERT]', ok ? 'OK' : 'FAIL', { scope, factKey, factValue, valueType, conf });
      }
    }

    // 6) Load facts for current scope + build prompt HARD first
    const sceneFacts = await getSceneFacts(req.supabase, userId, sceneKey, scope);

    let systemPrompt = [
      STRICT_FACT_GUARD,
      formatFactsBlock(sceneFacts, 'SCENE FACTS (HARD)'),
      formatSceneContextBlock(sceneContext),
      formatHardSceneContextBlock(sceneContext),
    ].filter(Boolean).join('\n\n');

    // 7) Persona + memory lower priority (vibe stays here)
    const coreOrigin = await loadCoreOrigin(req.supabase);
    const summaries = await loadSummaries(req.supabase);

    systemPrompt += '\n\n' + buildSystemPrompt(
      coreOrigin ? [{ narrative: coreOrigin }] : [],
      summaries || []
    );

    // 8) Episodic recall (optional, only confident)
    const recall = await recallEpisodicMemory(req.supabase, message);
    if (recall?.meta?.confident && Array.isArray(recall.memories) && recall.memories.length) {
      const episodicLines = recall.memories.slice(0, 4).map(m => `- ${m.narrative}`).join('\n');
      systemPrompt += `\n\n=== EPISODIC MEMORY ===\n${episodicLines}`;
    }

    // 9) choose engine + call
    const state = detectState(message);
    const engine = state === 'heated' ? 'grok' : 'openai';
    console.log('[ENGINE]', engine, 'state=', state);

    history.openai = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    const client = getLLMClient(engine);
    const model = MODELS[engine];

    const r = await client.responses.create({ model, input: history.openai });
    const reply = r.output_text || '…';

    // 10) persist SCC interaction
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine,
      last_engine_reply: reply,
      interaction_mode: state,
    });

    console.log('[REPLY]', reply.slice(0, 180));
    return res.json({ reply });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    return res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 IRIS backend running on port', process.env.PORT || 10000);
});
