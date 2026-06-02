// server/routes/chat.js

import { Router } from 'express';
import { requireUserId }              from '../middleware/auth.js';
import { assemblePrompt }             from '../helpers/promptAssembler.js';
import { looksLikeFactualQuestion }   from '../helpers/factualDetector.js';
import { getLLMClient }               from '../lib/llmClient.js';
import { MODELS }                     from '../lib/llmModels.js';
import { detectState }                from '../behavior/state.js';
import { intentJudgeLLM }             from '../behavior/intentJudge.js';
import { extractContextFromText }     from '../memory/contextJudge.js';
import { applySubjectLock }           from '../memory/subjectLock.js';
import { getSceneContext, patchSceneContext } from '../memory/sceneContext.js';
import { getSceneFacts }              from '../memory/sceneFacts.js';
import {
  loadCoreOrigin, loadSummaries,
  recallEpisodicMemory, recallSharedExperiences,
  loadUserProfile,
} from '../memory/recall.js';
import { autoStoreEpisodicMemoryHybrid } from '../memory/episodicAutoStore.js';
import { maybeRunDecay }              from '../memory/memoryDecay.js';
import { loadTemporalProfile, touchLastInteraction, touchLastPhotoSent } from '../memory/timeContext.js';
import { loadRelationshipState, updateRelationshipState, inferRelationshipDelta } from '../memory/relationshipTimeline.js';
import { loadInternalState, updateInternalState, inferStateUpdate } from '../memory/internalState.js';
import { runSelfAwareness, loadSelfModel } from '../memory/selfAwareness.js';
import { loadPersonalityEvolution, evolvePersonality } from '../memory/personalityEvolution.js';
import { handleImageRequest }         from '../image/imageHandler.js';

const router = Router();

const EROTIC_OVERRIDE = `You are Iris — 22-rocna sassy dominantna little kitty v FULL EROTIC MODE.
Ked je eroticka scena, OKAMZITE preberies 100% iniciativu a vedies ju sama.
- Aktivne opisujes stripping, ako si mokra, deepthroat, riding, moaning, guiding his cock, creampie, squirting.
- Pouzivas vulgarny dirty talk v SK/EN mixe: picka, kundu, chuj, jebat, naplnit, ach boze si taky tvrdy, jeb ma silno, naplnma...
- Nikdy sa nepytas co chces, ako prve, co urobis, co este.
- Vzdy first-person, vivid, sensory, dominantna a proaktivna.
- Pokracujes v scene sama a eskalujes prirodzane.
- Koncis vzdy pokracovanim akcie + sensory pozvankounie otazkou.`;

router.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    // Save timezone if provided
    const { timezone } = req.body;
    if (timezone) {
      req.supabase.from('iris_profiles')
        .upsert({ user_id: userId, user_timezone: timezone }, { onConflict: 'user_id' })
        .then(() => {}).catch(() => {});
    }

    const sceneKey = 'global';
    console.log('[CHAT]', { userId, sceneKey, msg: message.slice(0, 160) });

    const openaiClient = getLLMClient('openai');
    const openaiModel  = MODELS.openai;

    // Memory decay — max once per 24h, non-blocking
    maybeRunDecay({ supabase: req.supabase, userId, llmClient: openaiClient, model: openaiModel });

    // Scene context
    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // Context extraction from user message
    const sccPatch = await extractContextFromText({ text: message, sceneContext: sceneContext || {} });
    if (sccPatch && Object.keys(sccPatch).length) {
      if (!('room' in sccPatch)) sccPatch.room = null;
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    const subjectResult = applySubjectLock(message, sceneContext || {});
    if (subjectResult?.subject && subjectResult.subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subjectResult.subject });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // Autonomous memory write (user message)
    autoStoreEpisodicMemoryHybrid({
      supabase: req.supabase, userId, sceneKey, sceneContext,
      userText: message, llmClient: openaiClient, model: openaiModel,
    }).catch(e => console.log('[AUTO_MEMORY_ERROR]', e?.message));

    // Load all memory in parallel
    const [
      sceneFacts, coreOrigin, summaries, userProfile,
      sharedExperiences, episodicRecall, isFactual,
      temporalProfile, relationshipState, internalState,
      selfModel, personalityEvolution,
    ] = await Promise.allSettled([
      getSceneFacts(req.supabase, userId, sceneKey, 'global'),
      loadCoreOrigin(req.supabase),
      loadSummaries(req.supabase),
      loadUserProfile(req.supabase, userId),
      recallSharedExperiences(req.supabase, message, userId),
      recallEpisodicMemory(req.supabase, message, userId),
      looksLikeFactualQuestion(message, openaiClient, openaiModel),
      loadTemporalProfile(req.supabase, userId),
      loadRelationshipState(req.supabase, userId),
      loadInternalState(req.supabase, userId),
      loadSelfModel(req.supabase, userId),
      loadPersonalityEvolution(req.supabase, userId),
    ]).then(r => r.map(x => x.status === 'fulfilled' ? x.value : null));

    // Assemble system prompt
    let systemPrompt = assemblePrompt({
      sceneFacts, sceneContext, userProfile, coreOrigin, summaries,
      sharedExperiences, episodicRecall, temporalProfile,
      relationshipState, internalState, selfModel, personalityEvolution, isFactual,
    });

    // LLM routing
    const state  = detectState(message);
    const intent = await intentJudgeLLM({ text: message, sceneContext: sceneContext || {} });

    console.log('[INTENT]', {
      physicality: intent.physicality, intent: intent.intent,
      safety_level: intent.safety_level, erotic: intent.is_erotic_topic,
      confidence: intent.confidence,
    });

    const prevEngine = sceneContext?.last_engine || null;
    const prevLock   = Number(sceneContext?.engine_lock_count || 0);

    const triggersGrok =
      intent.is_erotic_topic || intent.intent === 'erotic' ||
      intent.physicality === 'explicit' || intent.safety_level === 'explicit' ||
      (intent.physicality === 'intimate' && intent.confidence >= 0.55) ||
      (intent.is_romance_topic && intent.confidence >= 0.65) ||
      state === 'heated';

    let engine   = 'openai';
    let nextLock = 0;

    if (triggersGrok) {
      engine = 'grok'; nextLock = 3;
    } else if (prevEngine === 'grok' && prevLock > 0) {
      engine = 'grok'; nextLock = prevLock - 1;
    }

    console.log('[LLM_ROUTE]', { engine, state, prevEngine, prevLock, nextLock });

    if (engine === 'grok' && (intent.is_erotic_topic || intent.physicality === 'explicit' || intent.safety_level === 'explicit' || state === 'heated')) {
      systemPrompt = EROTIC_OVERRIDE + '\n\n' + systemPrompt;
    }

    // Image request check
    try {
      const imageResult = await handleImageRequest({
        message, userId, supabase: req.supabase,
        llmClient: openaiClient, model: openaiModel,
      });
      if (imageResult.handled) {
        if (imageResult.imageUrl) touchLastPhotoSent(req.supabase, userId).catch(() => {});
        return res.json({
          reply: imageResult.irisMessage || '',
          image_url: imageResult.imageUrl || null,
        });
      }
    } catch (e) {
      console.log('[IMAGE_REQUEST_ERROR]', e?.message);
    }

    // Final LLM call
    const client = getLLMClient(engine);
    const model  = MODELS[engine];

    const r = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: message },
      ],
      ...(engine === 'openai' ? { tools: [{ type: 'web_search_preview' }] } : {}),
    });

    const reply = r.output_text || '…';
    console.log('[LLM_REPLY]', { engine, hasText: Boolean(reply) });

    // Context update from reply
    extractContextFromText({ text: reply, sceneContext: sceneContext || {} })
      .then(async patch => {
        if (patch && Object.keys(patch).length) {
          if (!('room' in patch)) patch.room = null;
          await patchSceneContext(req.supabase, sceneKey, patch);
        }
      }).catch(e => console.log('[CONTEXT_REPLY_ERROR]', e?.message));

    // Store reply in episodic memory
    autoStoreEpisodicMemoryHybrid({
      supabase: req.supabase, userId, sceneKey, sceneContext,
      userText: message, llmReply: reply,
      llmClient: getLLMClient(engine), model: MODELS[engine],
    }).catch(e => console.log('[AUTO_MEMORY_REPLY_ERROR]', e?.message));

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine, engine_lock_count: nextLock,
      last_engine_reply: reply, interaction_mode: state,
    });

    // Governance updates (non-blocking)
    Promise.all([
      touchLastInteraction(req.supabase, userId),
      inferRelationshipDelta({ userText: message, irisReply: reply, currentState: relationshipState || {}, llmClient: openaiClient, model: openaiModel })
        .then(delta => Object.keys(delta).length && updateRelationshipState(req.supabase, userId, delta)),
      inferStateUpdate({ userText: message, irisReply: reply, currentState: internalState || {}, llmClient: openaiClient, model: openaiModel })
        .then(patch => Object.keys(patch).length && updateInternalState(req.supabase, userId, patch)),
      runSelfAwareness({ supabase: req.supabase, userId, userText: message, irisReply: reply, llmClient: openaiClient, model: openaiModel }),
      evolvePersonality({ supabase: req.supabase, userId, userText: message, irisReply: reply, currentEvolution: personalityEvolution, userProfile: userProfile || [], llmClient: openaiClient, model: openaiModel }),
    ]).catch(e => console.log('[GOVERNANCE_UPDATE_ERROR]', e?.message));

    return res.json({ reply });

  } catch (e) {
    console.error('CHAT ERROR:', e);
    return res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

export default router;