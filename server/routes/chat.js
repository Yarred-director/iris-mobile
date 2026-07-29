// server/routes/chat.js

import { Router } from 'express';
import { requireUserId } from '../middleware/auth.js';
import { assemblePrompt } from '../helpers/promptAssembler.js';
import { looksLikeFactualQuestion } from '../helpers/factualDetector.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { detectState } from '../behavior/state.js';
import { intentJudgeLLM } from '../behavior/intentJudge.js';
import { extractContextFromText } from '../memory/contextJudge.js';
import { applySubjectLock } from '../memory/subjectLock.js';
import { getSceneContext, patchSceneContext } from '../memory/sceneContext.js';
import { getSceneFacts } from '../memory/sceneFacts.js';
import {
  loadCoreOrigin, loadSummaries,
  recallEpisodicMemory, recallSharedExperiences,
  loadUserProfile,
} from '../memory/recall.js';
import { autoStoreEpisodicMemoryHybrid } from '../memory/episodicAutoStore.js';
import { createEmbedding } from '../memory/embeddings.js';
import { maybeRunDecay } from '../memory/memoryDecay.js';
import { loadTemporalProfile, touchLastInteraction, touchLastPhotoSent } from '../memory/timeContext.js';
import { loadRelationshipState, updateRelationshipState, inferRelationshipDelta } from '../memory/relationshipTimeline.js';
import { loadInternalState, updateInternalState, inferStateUpdate } from '../memory/internalState.js';
import { runSelfAwareness, loadSelfModel } from '../memory/selfAwareness.js';
import { loadPersonalityEvolution, evolvePersonality } from '../memory/personalityEvolution.js';
import {
  couldBeFactualQuestion,
  looksLikeImageRequest,
  shouldClassifyIntent,
  shouldExtractSceneContext,
  shouldPersistExchange,
  shouldRunPersonalityEvolution,
  shouldRunRelationshipUpdate,
  shouldRunSelfAwareness,
  shouldRunSemanticRecall,
} from '../memory/memoryPolicy.js';
import { handleImageRequest } from '../image/imageHandler.js';

const router = Router();

const SAFE_INTENT = {
  physicality: 'none',
  intent: 'neutral',
  safety_level: 'safe',
  is_body_topic: false,
  is_romance_topic: false,
  is_erotic_topic: false,
  confidence: 1,
};

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
    const message = (req.body?.message || '').toString().trim();
    if (!message) return res.json({ reply: '…' });

    const userId = await requireUserId(req, res);
    if (!userId) return;

    const timezone = req.body?.timezone || req.header('x-timezone') || null;
    if (timezone) {
      req.supabase.from('iris_profiles')
        .upsert({ user_id: userId, user_timezone: timezone }, { onConflict: 'user_id' })
        .then(({ error }) => error && console.log('[TIMEZONE_SAVE_ERROR]', error.message))
        .catch(e => console.log('[TIMEZONE_SAVE_ERROR]', e?.message));
    }

    const sceneKey = 'global';
    console.log('[CHAT]', { userId, sceneKey, msg: message.slice(0, 160) });

    const openaiClient = getLLMClient('openai');
    const openaiModel = MODELS.openai;

    maybeRunDecay({ supabase: req.supabase, userId, llmClient: openaiClient, model: openaiModel });

    let sceneContext = await getSceneContext(req.supabase, sceneKey);

    // Scene extraction is expensive; run it only when the message contains a scene/time signal.
    if (shouldExtractSceneContext(message)) {
      const sccPatch = await extractContextFromText({ text: message, sceneContext: sceneContext || {} });
      if (sccPatch && Object.keys(sccPatch).length) {
        await patchSceneContext(req.supabase, sceneKey, sccPatch);
        sceneContext = await getSceneContext(req.supabase, sceneKey);
      }
    }

    const subjectResult = applySubjectLock(message, sceneContext || {});
    if (subjectResult?.subject && subjectResult.subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subjectResult.subject });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    // One embedding is shared by episodic and shared-experience recall.
    let queryEmbedding = null;
    if (shouldRunSemanticRecall(message)) {
      try {
        queryEmbedding = await createEmbedding(message);
      } catch (e) {
        console.log('[QUERY_EMBEDDING_ERROR]', e?.message);
      }
    }

    const emptyRecall = { memories: [], meta: { confident: false, reason: 'policy_skipped' } };
    const recallSharedTask = queryEmbedding
      ? recallSharedExperiences(req.supabase, message, userId, queryEmbedding)
      : Promise.resolve([]);
    const recallEpisodicTask = queryEmbedding
      ? recallEpisodicMemory(req.supabase, message, userId, queryEmbedding)
      : Promise.resolve(emptyRecall);
    const factualTask = couldBeFactualQuestion(message)
      ? looksLikeFactualQuestion(message, openaiClient, openaiModel)
      : Promise.resolve(false);

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
      recallSharedTask,
      recallEpisodicTask,
      factualTask,
      loadTemporalProfile(req.supabase, userId),
      loadRelationshipState(req.supabase, userId),
      loadInternalState(req.supabase, userId),
      loadSelfModel(req.supabase, userId),
      loadPersonalityEvolution(req.supabase, userId),
    ]).then(results => results.map(item => item.status === 'fulfilled' ? item.value : null));

    let systemPrompt = assemblePrompt({
      sceneFacts, sceneContext, userProfile, coreOrigin, summaries,
      sharedExperiences, episodicRecall, temporalProfile,
      relationshipState, internalState, selfModel, personalityEvolution, isFactual,
    });

    const state = detectState(message);
    const intent = shouldClassifyIntent(message)
      ? await intentJudgeLLM({ text: message, sceneContext: sceneContext || {} })
      : SAFE_INTENT;

    const prevEngine = sceneContext?.last_engine || null;
    const prevLock = Number(sceneContext?.engine_lock_count || 0);
    const triggersGrok =
      intent.is_erotic_topic || intent.intent === 'erotic' ||
      intent.physicality === 'explicit' || intent.safety_level === 'explicit' ||
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

    if (engine === 'grok' && triggersGrok) {
      systemPrompt = EROTIC_OVERRIDE + '\n\n' + systemPrompt;
    }

    // Do not run an image-intent LLM classifier for every ordinary text message.
    if (looksLikeImageRequest(message)) {
      try {
        const imageResult = await handleImageRequest({
          message, userId, supabase: req.supabase,
          llmClient: openaiClient, model: openaiModel,
        });
        if (imageResult.handled) {
          await touchLastInteraction(req.supabase, userId);
          if (imageResult.imageUrl) touchLastPhotoSent(req.supabase, userId).catch(() => {});
          return res.json({
            reply: imageResult.irisMessage || '',
            image_url: imageResult.imageUrl || null,
          });
        }
      } catch (e) {
        console.log('[IMAGE_REQUEST_ERROR]', e?.message);
      }
    }

    const client = getLLMClient(engine);
    const model = MODELS[engine];
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      ...(engine === 'openai' && isFactual ? { tools: [{ type: 'web_search_preview' }] } : {}),
    });

    const reply = response.output_text || '…';
    console.log('[LLM_REPLY]', { engine, hasText: Boolean(reply) });

    // Store at most one exchange memory, not separate user and Iris rows.
    if (shouldPersistExchange(message, reply)) {
      autoStoreEpisodicMemoryHybrid({
        supabase: req.supabase, userId, sceneKey, sceneContext,
        userText: message, llmReply: reply,
        llmClient: getLLMClient(engine), model: MODELS[engine],
      }).catch(e => console.log('[AUTO_MEMORY_EXCHANGE_ERROR]', e?.message));
    }

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: engine,
      engine_lock_count: nextLock,
      last_engine_reply: reply,
      interaction_mode: state,
    });

    // Governance is event-driven instead of four LLM calls after every message.
    const governanceJobs = [touchLastInteraction(req.supabase, userId)];

    if (shouldRunRelationshipUpdate(message, reply)) {
      governanceJobs.push(
        inferRelationshipDelta({
          userText: message, irisReply: reply, currentState: relationshipState || {},
          llmClient: openaiClient, model: openaiModel,
        }).then(delta => Object.keys(delta).length && updateRelationshipState(req.supabase, userId, delta)),
        inferStateUpdate({
          userText: message, irisReply: reply, currentState: internalState || {},
          llmClient: openaiClient, model: openaiModel,
        }).then(patch => Object.keys(patch).length && updateInternalState(req.supabase, userId, patch)),
      );
    }

    if (shouldRunSelfAwareness(message, reply)) {
      governanceJobs.push(runSelfAwareness({
        supabase: req.supabase, userId, userText: message, irisReply: reply,
        llmClient: openaiClient, model: openaiModel,
      }));
    }

    if (shouldRunPersonalityEvolution(message)) {
      governanceJobs.push(evolvePersonality({
        supabase: req.supabase, userId, userText: message, irisReply: reply,
        currentEvolution: personalityEvolution, userProfile: userProfile || [],
        llmClient: openaiClient, model: openaiModel,
      }));
    }

    Promise.allSettled(governanceJobs)
      .then(results => {
        const failed = results.filter(item => item.status === 'rejected');
        if (failed.length) console.log('[GOVERNANCE_UPDATE_ERRORS]', failed.length);
      });

    return res.json({ reply });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    return res.status(500).json({ error: e.message || 'unknown_error' });
  }
});

export default router;
