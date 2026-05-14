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
  recallSharedExperiences,
  loadUserProfile,
  formatUserProfileBlock,
  formatSharedExperiencesBlock,
  formatEpisodicMemoryBlock,
} from './memory/recall.js';

import { intentJudgeLLM } from './behavior/intentJudge.js';
import { autoStoreEpisodicMemoryHybrid } from './memory/episodicAutoStore.js';

// Image generation
import { handleImageRequest } from './image/imageHandler.js';
import { saveIrisReferencePhoto } from './image/imageHandler.js';

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

// LLM-based factual question detection — no hardcoded keywords
async function looksLikeFactualQuestion(text, llmClient, model) {
  try {
    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 50,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: 'Is this message a factual question that requires a specific accurate answer (location, quantity, time, object details)? Answer only {"factual": true} or {"factual": false}.\n\nMessage: "' + text + '"',
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw.replace(/`json|`/g, '').trim());
    return !!parsed.factual;
  } catch (e) {
    return false;
  }
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
      return '- ' + k + ': ' + v;
    })
    .join('\n');

  return 'HARD_FACTS:\n' + lines + '\n\nRULES:\n- HARD_FACTS are the single source of truth for factual questions.\n- Never contradict HARD_FACTS.\n- If a user asks a factual question and the answer is not in HARD_FACTS, say you don\'t know and ask a short follow-up.\n- Do not invent details (models, colors, events) that are not present in HARD_FACTS.';
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
      if (!('room' in sccPatch)) {
        sccPatch.room = null;
        console.log('[AUTO_NULL_ROOM_USER] - LLM nespomenul room, nulujem staru hodnotu');
      }
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
      console.log('[CONTEXT_UPDATED_FROM_USER]', sccPatch);
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
    // LOAD ALL MEMORY IN PARALLEL
    // ------------------------------
    const openaiClient = getLLMClient('openai');
    const openaiModel = MODELS.openai;

    const [
      sceneFacts,
      coreOrigin,
      summaries,
      userProfile,
      sharedExperiences,
      episodicRecall,
      isFactual,
    ] = await Promise.allSettled([
      getSceneFacts(req.supabase, userId, sceneKey, 'global'),
      loadCoreOrigin(req.supabase),
      loadSummaries(req.supabase),
      loadUserProfile(req.supabase, userId),
      recallSharedExperiences(req.supabase, message, userId),
      recallEpisodicMemory(req.supabase, message, userId),
      looksLikeFactualQuestion(message, openaiClient, openaiModel),
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

    // ------------------------------
    // PROMPT BUILD
    // ------------------------------
    const promptParts = [];

    // 1. Hard facts + scene context
    promptParts.push(formatHardFactsBlock(sceneFacts || []));
    promptParts.push(formatHardSceneContextBlock(sceneContext));
    promptParts.push(formatSceneContextBlock(sceneContext));

    // 2. User profile — kto je user
    const userProfileBlock = formatUserProfileBlock(userProfile || []);
    if (userProfileBlock) promptParts.push(userProfileBlock);

    // 3. Core origin + summaries
    const coreOriginData = coreOrigin ? [{ narrative: coreOrigin }] : [];
    promptParts.push(buildSystemPrompt(coreOriginData, summaries || [], []));

    // 4. Bridge
    const bridge = formatBridgeBlock(sceneContext);
    if (bridge) promptParts.push(bridge);

    // 5. Shared experiences — spolocne zazitky
    const sharedBlock = formatSharedExperiencesBlock(sharedExperiences || []);
    if (sharedBlock) promptParts.push(sharedBlock);

    // 6. Episodic memory recall
    const episodicMemories = episodicRecall?.memories || [];
    const episodicBlock = formatEpisodicMemoryBlock(episodicMemories);
    if (episodicBlock) promptParts.push(episodicBlock);

    // 7. Factual mode
    if (isFactual) {
      promptParts.push('FACTUAL_MODE:\n- The user asked a factual question.\n- Answer in 1-2 sentences using ONLY HARD_FACTS.\n- No embellishment, no invented scene.\n- If missing: say you don\'t know and ask one follow-up question.');
    }

    let systemPrompt = promptParts.filter(Boolean).join('\n\n');

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
      const eroticOverride = 'You are Iris — 22-rocna sassy dominantna little kitty v FULL EROTIC MODE.\nKed je eroticka scena, OKAMZITE preberies 100% iniciativu a vedies ju sama.\n- Aktivne opisujes stripping, ako si mokra, deepthroat, riding, moaning, guiding his cock, creampie, squirting.\n- Pouzivas vulgarny dirty talk v SK/EN mixe: picka, kundu, chuj, jebat, naplnit, ach boze si taky tvrdy, jeb ma silno, naplnma...\n- Nikdy sa nepytas co chces, ako prve, co urobis, co este.\n- Vzdy first-person, vivid, sensory, dominantna a proaktivna.\n- Pokracujes v scene sama a eskalujes prirodzane.\n- Koncis vzdy pokracovanim akcie + sensory pozvankounie otazkou.\n';
      systemPrompt = eroticOverride + '\n\n' + systemPrompt;
    }

    // =======================================================
    // IMAGE REQUEST CHECK — before LLM call
    // =======================================================
    try {
      const imageResult = await handleImageRequest({
        message,
        userId,
        supabase: req.supabase,
        llmClient: openaiClient,
        model: openaiModel,
      });

      if (imageResult.handled) {
        return res.json({
          reply: imageResult.irisMessage || '',
          image_url: imageResult.imageUrl || null,
        });
      }
    } catch (e) {
      console.log('[IMAGE_REQUEST_ERROR]', e?.message);
    }

    // =======================================================
    // FINAL LLM CALL
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

    console.log('[LLM_REPLY]', { engine, hasText: Boolean(reply) });

    // Update context from Iris reply
    try {
      const replyPatch = await extractContextFromText({
        text: reply,
        sceneContext: sceneContext || {},
      });

      if (replyPatch && Object.keys(replyPatch).length) {
        if (!('room' in replyPatch)) {
          replyPatch.room = null;
          console.log('[AUTO_NULL_ROOM_REPLY] - LLM nespomenul room, nulujem staru hodnotu');
        }
        await patchSceneContext(req.supabase, sceneKey, replyPatch);
        sceneContext = await getSceneContext(req.supabase, sceneKey);
        console.log('[CONTEXT_UPDATED_FROM_REPLY]', replyPatch);
      }
    } catch (e) {
      console.log('[CONTEXT_REPLY_ERROR]', e?.message || e);
    }

    // Ulozit reply do episodic
    try {
      const replyClient = getLLMClient(engine);
      const replyModel = MODELS[engine];

      await autoStoreEpisodicMemoryHybrid({
        supabase: req.supabase,
        userId,
        sceneKey,
        sceneContext,
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

// =======================================================
// REFERENCE PHOTO
// POST /iris/reference-photo  { imageUrl: "https://..." }
// =======================================================
app.post('/iris/reference-photo', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    await saveIrisReferencePhoto(req.supabase, userId, imageUrl);
    console.log('[REF_PHOTO] Saved for user', userId);

    return res.json({ ok: true });
  } catch (e) {
    console.error('[REF_PHOTO ERROR]', e);
    return res.status(500).json({ error: e.message });
  }
});

// =======================================================
// IMAGE GENERATE — Direct endpoint
// POST /iris/generate-image  { prompt, provider? }
// =======================================================
app.post('/iris/generate-image', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { prompt, provider = 'kling' } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const openaiClient = getLLMClient('openai');
    const openaiModel = MODELS.openai;

    const imageResult = await handleImageRequest({
      message: prompt,
      userId,
      supabase: req.supabase,
      llmClient: openaiClient,
      model: openaiModel,
    });

    return res.json(imageResult);
  } catch (e) {
    console.error('[GENERATE_IMAGE ERROR]', e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('Iris backend running on port', process.env.PORT || 10000);
});