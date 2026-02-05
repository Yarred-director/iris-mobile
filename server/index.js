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

import { factJudge } from './memory/factJudge.js';
import { getActiveFactSchema } from './memory/factSchema.js';
import {
  getSceneFacts,
  upsertSceneFact,
} from './memory/sceneFacts.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory,
} from './memory/recall.js';

// 🔔 NEW: time-based reminders
import { buildReminderFromText } from './memory/timeJudge.js';

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

function safeJsonParse(s, fallback) {
  try {
    if (Array.isArray(s)) return s;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function buildWorkingTurns(sceneContext) {
  const raw = sceneContext?.bridge_buffer;
  const arr = safeJsonParse(raw, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (x) =>
        x &&
        (x.role === 'user' || x.role === 'assistant') &&
        typeof x.content === 'string'
    )
    .slice(-6);
}

function pushWorkingTurns(sceneContext, userMsg, assistantMsg) {
  const prev = buildWorkingTurns(sceneContext);
  const next = [
    ...prev,
    { role: 'user', content: String(userMsg || '').slice(0, 900) },
    { role: 'assistant', content: String(assistantMsg || '').slice(0, 900) },
  ].slice(-6);
  return JSON.stringify(next);
}

async function requireUserId(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

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

function formatFactsBlock(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const lines = rows.map((r) => `- ${r.fact_key}: ${r.fact_value}`).join('\n');
  return `SCENE_FACTS_HARD:\n${lines}\nRULE: Do NOT invent missing facts.`;
}

const STRICT_FACT_GUARD = `
TRUTH RULES (keep human vibe):
- Never invent, guess, or assume facts.
- Facts must come only from SCENE_FACTS_HARD and HARD_CONTEXT.
- If a fact is missing, say it naturally (1 sentence) and ask ONE short follow-up question.
- Do not repeat location/time unless the user asks or it matters naturally.
`.trim();

app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    const sceneKey = 'global';

    console.log('[CHAT]', { userId, sceneKey, msg: message.slice(0, 160) });

    // 1) Load SCC
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // ⏱️ NEW: timezone from device (no hardcode)
    const tz = (req.headers['x-timezone'] || '').toString().trim();
    if (tz && tz.length < 64 && tz !== sceneContext?.timezone) {
      await patchSceneContext(req.supabase, sceneKey, { timezone: tz });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[TIMEZONE_SET]', tz);
    }

    // 2) Deterministic SCC patch
    const sccPatch = extractContextFromText({
      text: message,
      sceneContext: sceneContext || {},
    });

    if (sccPatch && Object.keys(sccPatch).length) {
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[SCC_PATCH]', sccPatch);
    }

    // 3) Subject lock
    const subjectResult = applySubjectLock(message, sceneContext || {});
    if (
      subjectResult?.subject &&
      subjectResult.subject !== sceneContext?.last_subject
    ) {
      await patchSceneContext(req.supabase, sceneKey, {
        last_subject: subjectResult.subject,
      });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[SUBJECT]', subjectResult.subject);
    }

    // 4) Scope
    const scopeCandidate =
      sceneContext?.location_country ||
      sceneContext?.location_city ||
      sceneContext?.place ||
      'global';
    const scope = slugifyScope(scopeCandidate);

    console.log('[SCOPE]', { scopeCandidate, scope });

    // 5) Schema-driven fact extraction
    const schema = await getActiveFactSchema(req.supabase);
    console.log('[FACT_SCHEMA_COUNT]', schema.length);

    if (schema.length > 0) {
      const extracted = await factJudge({ text: message, schema });
      console.log('[FACT_EXTRACTED]', extracted);

      if (Array.isArray(extracted) && extracted.length) {
        for (const f of extracted) {
          const factKey = f.fact_key;
          const conf = typeof f.confidence === 'number' ? f.confidence : 0.9;
          const rawVal = f.fact_value;

          const valueType =
            rawVal !== null && typeof rawVal === 'object'
              ? 'json'
              : typeof rawVal === 'number'
              ? 'number'
              : typeof rawVal === 'boolean'
              ? 'boolean'
              : 'text';

          const factValue =
            rawVal !== null && typeof rawVal === 'object'
              ? JSON.stringify(rawVal)
              : String(rawVal);

          await upsertSceneFact(
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
        }
      }
    }

    // 🔔 NEW: time-based reminder (push)
    const reminder = buildReminderFromText({
      text: message,
      timezone: sceneContext?.timezone || tz || 'UTC',
    });

    if (reminder) {
      const { error } = await req.supabase.from('reminders').insert({
        user_id: userId,
        due_at: reminder.due_at,
        title: reminder.title,
        body: reminder.body,
        meta: reminder.meta,
        status: 'pending',
      });

      console.log('[REMINDER_CREATE]', error ? 'FAIL' : 'OK', reminder?.due_at);
    }

    // 6) Read facts
    const sceneFacts = await getSceneFacts(
      req.supabase,
      userId,
      sceneKey,
      scope
    );

    // 7) Build system prompt
    let systemPrompt = [
      STRICT_FACT_GUARD,
      formatFactsBlock(sceneFacts),
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

    // 8) Episodic recall
    const recall = await recallEpisodicMemory(req.supabase, message);
    if (
      recall?.meta?.confident &&
      Array.isArray(recall.memories) &&
      recall.memories.length
    ) {
      const episodicLines = recall.memories
        .slice(0, 4)
        .map((m) => `- ${m.narrative}`)
        .join('\n');
      systemPrompt += `\n\nEPISODIC_MEMORY:\n${episodicLines}`;
    }

    // 9) Working memory
    const working = buildWorkingTurns(sceneContext);

    // 10) Engine
    const state = detectState(message);
    const engine = state === 'heated' ? 'grok' : 'openai';
    console.log('[ENGINE]', { engine, state });

    history.openai = [
      { role: 'system', content: systemPrompt },
      ...working,
      { role: 'user', content: message },
    ];

    const client = getLLMClient(engine);
    const model = MODELS[engine];

    const r = await client.responses.create({
      model,
      input: history.openai,
    });

    const reply = r.output_text || '…';

    // 11) Persist SCC + working memory
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine,
      last_engine_reply: reply,
      interaction_mode: state,
      bridge_buffer: pushWorkingTurns(sceneContext, message, reply),
    });

    console.log('[REPLY]', reply.slice(0, 180));
    return res.json({ reply });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    return res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running on port', process.env.PORT || 10000);
});