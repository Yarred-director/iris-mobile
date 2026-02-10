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
import { getSceneFacts, upsertSceneFact } from './memory/sceneFacts.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory,
} from './memory/recall.js';

// 🔔 REMINDERS
import {
  buildReminderFromIntent,
  buildReminderFromText,
  looksLikeReminder,
  timeIntentJudgeLLM,
} from './memory/timeJudge.js';

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
// PUSH TOKEN REGISTER
// =======================================================
app.post('/push/register', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const expoPushToken = (req.body?.expo_push_token || '').toString().trim();
    const platform = (req.body?.platform || '').toString().trim() || null;
    const deviceId = (req.body?.device_id || '').toString().trim() || null;

    console.log('[PUSH_REGISTER]', {
      userId,
      token_last6: expoPushToken ? expoPushToken.slice(-6) : null,
      platform,
      deviceId,
    });

    if (!expoPushToken) {
      return res.status(400).json({ error: 'MISSING_TOKEN' });
    }

    // Upsert by user_id => updated_at sa MUSÍ meniť
    const { data, error } = await req.supabase
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          expo_push_token: expoPushToken,
          platform,
          device_id: deviceId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('id, user_id, updated_at')
      .single();

    if (error) {
      console.error('[PUSH_REGISTER_FAIL]', error);
      return res.status(500).json({ error: 'DB_FAIL' });
    }

    return res.json({ ok: true, row: data });
  } catch (e) {
    console.error('[PUSH_REGISTER_ERR]', e);
    return res.status(500).json({ error: e?.message || 'SERVER_ERR' });
  }
});

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
    // TIMEZONE
    // ------------------------------
    const tz = (req.headers['x-timezone'] || '').toString().trim();
    if (tz && tz.length < 64 && tz !== sceneContext?.timezone) {
      await patchSceneContext(req.supabase, sceneKey, { timezone: tz });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[TIMEZONE_SET]', tz);
    }

    const effectiveTz = sceneContext?.timezone || tz || 'UTC';

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
      console.log('[SCC_PATCH]', sccPatch);
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
      console.log('[SUBJECT]', subjectResult.subject);
    }

    // ------------------------------
    // FACTS
    // ------------------------------
    const schema = await getActiveFactSchema(req.supabase);
    if (schema.length > 0) {
      const extracted = await factJudge({ text: message, schema });
      if (Array.isArray(extracted)) {
        for (const f of extracted) {
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
            'global',
            f.fact_key,
            factValue,
            valueType,
            f.confidence ?? 0.9,
            'user'
          );
        }
      }
    }

    // =======================================================
    // 🔔 REMINDER PIPELINE
    // =======================================================
    let reminderDraft = null;

    if (looksLikeReminder(message)) {
      try {
        const client = getLLMClient('openai');
        const model = MODELS.openai;

        const intent = await timeIntentJudgeLLM({
          client,
          model,
          text: message,
          timezone: effectiveTz,
          nowISO: new Date().toISOString(),
        });

        console.log('[TIME_INTENT]', intent);

        if (intent && (intent.confidence ?? 0) >= 0.55) {
          reminderDraft = buildReminderFromIntent({
            intent,
            originalText: message,
            timezone: effectiveTz,
          });
        }
      } catch (e) {
        console.error('[TIME_INTENT_FAIL]', e?.message || e);
      }
    }

    if (!reminderDraft) {
      reminderDraft = buildReminderFromText({
        text: message,
        timezone: effectiveTz,
      });
    }

    console.log('[REMINDER_JUDGE]', {
      tz: effectiveTz,
      msg: message.slice(0, 140),
      reminderDraft,
    });

    if (reminderDraft) {
      const { error, data } = await req.supabase
        .from('reminders')
        .insert({
          user_id: userId,
          due_at: reminderDraft.due_at,
          title: reminderDraft.title,
          body: reminderDraft.body,
          meta: reminderDraft.meta,
          status: 'pending',
        })
        .select('id, due_at, status')
        .single();

      if (error) console.error('[REMINDER_CREATE_FAIL]', error);
      else console.log('[REMINDER_CREATE_OK]', data);
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
    // LLM CALL
    // ------------------------------
    const state = detectState(message);
    const engine = state === 'heated' ? 'grok' : 'openai';

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