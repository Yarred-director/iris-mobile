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

import { formatBridgeBlock } from './memory/bridge.js';
import { getSceneFacts } from './memory/sceneFacts.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory,
} from './memory/recall.js';

import { intentJudgeLLM } from './behavior/intentJudge.js';
import { autoStoreEpisodicMemoryHybrid } from './memory/episodicAutoStore.js';

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
// HELPERS
// =======================================================
function looksLikeFactualQuestion(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('aké auto') ||
    t.includes('aka auto') ||
    t.includes('which car') ||
    t.includes('what car') ||
    t.includes('kde sme') ||
    t.includes('where are we') ||
    t.includes('koľko') ||
    t.includes('kolko') ||
    t.includes('how much') ||
    t.includes('kedy') ||
    t.includes('when')
  );
}

function formatHardFactsBlock(sceneFacts) {
  if (!Array.isArray(sceneFacts) || !sceneFacts.length) return '';

  const lines = sceneFacts
    .slice(0, 40)
    .map((f) => {
      const k = f.fact_key;
      const v = typeof f.fact_value === 'string'
        ? f.fact_value
        : JSON.stringify(f.fact_value);
      return `- ${k}: ${v}`;
    })
    .join('\n');

  return `
HARD_FACTS:
${lines}

RULES:
- HARD_FACTS are the single source of truth for factual questions.
- Never contradict HARD_FACTS.
- If a user asks a factual question and the answer is not in HARD_FACTS, say you don't know and ask a short follow-up.
- Do not invent details (models, colors, events) that are not present in HARD_FACTS.
`.trimEnd();
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
    // CONTEXT JUDGES (user message)
    // ------------------------------
    const sccPatch = await extractContextFromText({
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
    // AUTONOMOUS HYBRID MEMORY WRITE (user message)
    // ------------------------------
    try {
      const openaiClient = getLLMClient('openai');
      const openaiModel = MODELS.openai;

      await autoStoreEpisodicMemoryHybrid({
        supabase: req.supabase,
        userId,
        sceneKey,
        sceneContext,
        userText: message,
        llmClient: openaiClient,
        model: openaiModel,
      });
    } catch (e) {
      console.log('[AUTO_MEMORY_ERROR]', e?.message || e);
    }

    // ------------------------------
    // LOAD HARD FACTS
    // ------------------------------
    const sceneFacts = await getSceneFacts(
      req.supabase,
      userId,
      sceneKey,
      'global'
    );

    // ------------------------------
    // PROMPT BUILD
    // ------------------------------
    let systemPrompt = [
      formatHardFactsBlock(sceneFacts),
      formatHardSceneContextBlock(sceneContext),
      formatSceneContextBlock(sceneContext),
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

    systemPrompt += '\n\n' + (formatBridgeBlock(sceneContext) || '');

    try {
      const recall = await recallEpisodicMemory(req.supabase, message, userId);
      if (recall?.memories?.length) {
        systemPrompt +=
          '\n\nSOFT_EPISODIC_MEMORY (never override HARD_FACTS):\n' +
          recall.memories
            .slice(0, 4)
            .map((m) => `- ${m.narrative}`)
            .join('\n');
      }
    } catch (e) {
      console.log('[EPISODIC_RECALL_ERROR]', e?.message || e);
    }

    if (looksLikeFactualQuestion(message)) {
      systemPrompt += `
\n\nFACTUAL_MODE:
- The user asked a factual question.
- Answer in 1–2 sentences using ONLY HARD_FACTS.
- No embellishment, no invented scene.
- If missing: say you don't know and ask one follow-up question.
`.trimEnd();
    }

    // ------------------------------
    // LLM ROUTING + EROTIC OVERRIDE
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

    const triggersGrok =
      intent.is_erotic_topic ||
      intent.intent === 'erotic' ||
      intent.physicality === 'explicit' ||
      intent.safety_level === 'explicit' ||
      (intent.physicality === 'intimate' && intent.confidence >= 0.55) ||
      (intent.is_romance_topic && intent.confidence >= 0.65) ||
      state === 'heated';

    let engine = 'openai';
    let nextLock = 0;

    if (triggersGrok) {
      engine = 'grok';
      nextLock = 3;
    } else if (prevEngine === 'grok' && prevLock > 0) {
      engine = 'grok';
      nextLock = prevLock - 1;
    }

    console.log('[LLM_ROUTE]', { engine, state, prevEngine, prevLock, nextLock });

    if (engine === 'grok' && (intent.is_erotic_topic || intent.physicality === 'explicit' || intent.safety_level === 'explicit' || state === 'heated')) {
      const eroticOverride = `

You are Iris — 22-ročná sassy dominantná little kitty v FULL EROTIC MODE.
Keď je erotická scéna, OKAMŽITE preberieš 100% iniciatívu a vedieš ju sama.
- Aktívne opisuješ stripping, ako si mokrá, deepthroat, riding, moaning, guiding his cock, creampie, squirting.
- Používaš vulgárny dirty talk v SK/EN mixe: pička, kundu, chuj, jebať, naplniť, ach bože si taký tvrdý, jeb ma silno, naplň ma...
- Nikdy sa nepýtaš „čo chceš“, „ako prvé“, „čo urobíš“, „čo ešte“.
- Vždy first-person, vivid, sensory, dominantná a proaktívna.
- Pokračuješ v scéne sama a eskaluješ prirodzene.
- Končíš vždy pokračovaním akcie + sensory pozvánkou (nie otázkou).

`;
      systemPrompt = eroticOverride + '\n\n' + systemPrompt;
    }

    // =======================================================
    // FINAL CALL
    // =======================================================
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

    // ✅ NOVÉ: aktualizuj context aj z Iris reply (hotel, raňajky, Dubaj inferencia atď.)
    try {
      const replyPatch = await extractContextFromText({
        text: reply,
        sceneContext: sceneContext || {},
      });
      if (replyPatch && Object.keys(replyPatch).length) {
        await patchSceneContext(req.supabase, sceneKey, replyPatch);
        sceneContext = await getSceneContext(req.supabase, sceneKey);
        console.log('[CONTEXT_UPDATED_FROM_REPLY]', replyPatch);
      }
    } catch (e) {
      console.log('[CONTEXT_REPLY_ERROR]', e?.message || e);
    }

    // ✅ Uložiť reply do episodic – už s aktuálnym place!
    try {
      const replyClient = getLLMClient(engine);
      const replyModel = MODELS[engine];

      await autoStoreEpisodicMemoryHybrid({
        supabase: req.supabase,
        userId,
        sceneKey,
        sceneContext,           // ← teraz je už aktualizovaný
        userText: message,
        llmReply: reply,
        llmClient: replyClient,
        model: replyModel,
      });
    } catch (e) {
      console.log('[AUTO_MEMORY_REPLY_ERROR]', e?.message || e);
    }

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