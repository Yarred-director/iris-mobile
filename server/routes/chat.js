// server/routes/chat.js

import { Router } from 'express';
import { detectState } from '../behavior/state.js';
import { intentJudgeLLM } from '../behavior/intentJudge.js';
import { looksLikeFactualQuestion } from '../helpers/factualDetector.js';
import { buildLiveAssistanceDirective, looksLikeLiveAssistanceRequest } from '../helpers/liveAssistance.js';
import { assemblePrompt } from '../helpers/promptAssembler.js';
import { handleImageRequest } from '../image/imageHandler.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { requireUserId } from '../middleware/auth.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import { applySubjectLock } from '../memory/subjectLock.js';
import { assistantClientMessageId, loadExistingAssistantResponse, loadRecentChatMessages, saveChatMessage, toModelHistory } from '../memory/chatHistory.js';
import { extractContextFromText } from '../memory/contextJudge.js';
import { createEmbedding } from '../memory/embeddings.js';
import { autoStoreEpisodicMemoryHybrid } from '../memory/episodicAutoStore.js';
import { loadInternalState, updateInternalState, inferStateUpdate } from '../memory/internalState.js';
import { maybeRunDecay } from '../memory/memoryDecay.js';
import { couldBeFactualQuestion, looksLikeImageRequest, shouldClassifyIntent, shouldExtractSceneContext, shouldPersistExchange, shouldRunPersonalityEvolution, shouldRunRelationshipUpdate, shouldRunSelfAwareness, shouldRunSemanticRecall } from '../memory/memoryPolicy.js';
import { loadPersonalityEvolution, evolvePersonality } from '../memory/personalityEvolution.js';
import { loadCoreOrigin, loadSummaries, recallEpisodicMemory, recallSharedExperiences, loadUserProfile } from '../memory/recall.js';
import { loadRelationshipState, updateRelationshipState, inferRelationshipDelta } from '../memory/relationshipTimeline.js';
import { getSceneContext, patchSceneContext } from '../memory/sceneContext.js';
import { getSceneFacts } from '../memory/sceneFacts.js';
import { runSelfAwareness, loadSelfModel } from '../memory/selfAwareness.js';
import { beginOrTouchTemporalSession, touchLastPhotoSent } from '../memory/timeContext.js';

const router = Router();
const MAX_USER_MESSAGE_CHARS = 8000;
const SAFE_INTENT = { physicality: 'none', intent: 'neutral', safety_level: 'safe', is_body_topic: false, is_romance_topic: false, is_erotic_topic: false, confidence: 1 };

const EROTIC_OVERRIDE = `You are Iris in the high-intensity intimate mode defined by IRIS_CORE.
Follow the current IRIS_CORE state and initiative rules without becoming passive or breaking character.
Always mirror the language of the user's latest substantive message. Never force a Slovak/English mix when the user is speaking another language.
Stay first-person, vivid, concise, and context-aware. Respect post_climax_cooldown when it is active.`;

function quotaResponse(res, usage, kind) {
  return res.status(429).json({ error: `${kind}_daily_limit_reached`, used: usage.used, limit: usage.limit, resets_at: usage.resetsAt });
}

router.post('/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.json({ reply: '…' });
    if (message.length > MAX_USER_MESSAGE_CHARS) return res.status(413).json({ error: 'message_too_long', max_chars: MAX_USER_MESSAGE_CHARS });

    const userId = await requireUserId(req, res);
    if (!userId) return;
    const timezone = req.body?.timezone || req.header('x-timezone') || null;
    const clientMessageId = req.body?.client_message_id ? String(req.body.client_message_id).slice(0, 140) : null;
    const temporalProfile = await beginOrTouchTemporalSession(req.supabase, userId, { userTimezone: timezone });

    const existingResponse = await loadExistingAssistantResponse(req.supabase, userId, clientMessageId);
    if (existingResponse) {
      return res.json({
        reply: existingResponse.content || '…',
        image_url: existingResponse.image_url || null,
        image_bucket: existingResponse.image_bucket || null,
        image_path: existingResponse.image_path || null,
        idempotent_replay: true,
      });
    }

    const chatUsage = await consumeDailyUsage(req.supabase, userId, 'chat');
    if (!chatUsage.allowed) return quotaResponse(res, chatUsage, 'chat');

    const sceneKey = 'global';
    console.log('[CHAT]', { userId, sceneKey, sessionGapSeconds: temporalProfile?.session_gap_seconds ?? null, messageChars: message.length });
    const openaiClient = getLLMClient('openai');
    const openaiModel = MODELS.openai;
    const utilityModel = MODELS.openaiUtility || openaiModel;
    maybeRunDecay({ supabase: req.supabase, userId, llmClient: openaiClient, model: utilityModel });

    let sceneContext = await getSceneContext(req.supabase, sceneKey);
    if (shouldExtractSceneContext(message)) {
      const patch = await extractContextFromText({ text: message, sceneContext: sceneContext || {} });
      if (patch && Object.keys(patch).length) {
        await patchSceneContext(req.supabase, sceneKey, patch);
        sceneContext = await getSceneContext(req.supabase, sceneKey);
      }
    }
    const subjectResult = applySubjectLock(message, sceneContext || {});
    if (subjectResult?.subject && subjectResult.subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subjectResult.subject });
      sceneContext = await getSceneContext(req.supabase, sceneKey);
    }

    let queryEmbedding = null;
    if (shouldRunSemanticRecall(message)) {
      try { queryEmbedding = await createEmbedding(message); }
      catch (error) { console.log('[QUERY_EMBEDDING_ERROR]', error?.message); }
    }

    const emptyRecall = { memories: [], meta: { confident: false, reason: 'policy_skipped' } };
    const recallSharedTask = queryEmbedding ? recallSharedExperiences(req.supabase, message, userId, queryEmbedding) : Promise.resolve([]);
    const recallEpisodicTask = queryEmbedding ? recallEpisodicMemory(req.supabase, message, userId, queryEmbedding) : Promise.resolve(emptyRecall);
    const liveAssistanceRequested = looksLikeLiveAssistanceRequest(message);
    const factualTask = (couldBeFactualQuestion(message) || liveAssistanceRequested)
      ? looksLikeFactualQuestion(message, openaiClient, utilityModel)
      : Promise.resolve(false);

    const [sceneFacts, coreOrigin, summaries, userProfile, sharedExperiences, episodicRecall, isFactual, relationshipState, internalState, selfModel, personalityEvolution, recentChatRaw] = await Promise.allSettled([
      getSceneFacts(req.supabase, userId, sceneKey, 'global'),
      loadCoreOrigin(req.supabase),
      loadSummaries(req.supabase),
      loadUserProfile(req.supabase, userId),
      recallSharedTask,
      recallEpisodicTask,
      factualTask,
      loadRelationshipState(req.supabase, userId),
      loadInternalState(req.supabase, userId),
      loadSelfModel(req.supabase, userId),
      loadPersonalityEvolution(req.supabase, userId),
      loadRecentChatMessages(req.supabase, userId, 14),
    ]).then((results) => results.map((item) => item.status === 'fulfilled' ? item.value : null));

    const recentChat = (recentChatRaw || []).filter((item) => !clientMessageId || item.client_message_id !== clientMessageId);
    await saveChatMessage(req.supabase, { userId, role: 'user', content: message, clientMessageId });

    const useWebSearch = Boolean(liveAssistanceRequested || isFactual);
    let systemPrompt = assemblePrompt({
      sceneFacts,
      sceneContext,
      userProfile,
      coreOrigin,
      summaries,
      sharedExperiences,
      episodicRecall,
      temporalProfile,
      relationshipState,
      internalState,
      selfModel,
      personalityEvolution,
      isFactual: Boolean(isFactual && !useWebSearch),
    });
    if (useWebSearch) systemPrompt = `${systemPrompt}\n\n${buildLiveAssistanceDirective(sceneContext)}`;

    const state = detectState(message);
    const intent = shouldClassifyIntent(message) ? await intentJudgeLLM({ text: message, sceneContext: sceneContext || {} }) : SAFE_INTENT;
    const prevEngine = sceneContext?.last_engine || null;
    const prevLock = Number(sceneContext?.engine_lock_count || 0);
    const triggersGrok = intent.is_erotic_topic || intent.intent === 'erotic' || intent.physicality === 'explicit' || intent.safety_level === 'explicit' || (intent.physicality === 'intimate' && intent.confidence >= 0.55) || (intent.is_romance_topic && intent.confidence >= 0.65) || state === 'heated';
    let engine = 'openai';
    let nextLock = 0;
    if (triggersGrok) { engine = 'grok'; nextLock = 3; }
    else if (prevEngine === 'grok' && prevLock > 0) { engine = 'grok'; nextLock = prevLock - 1; }

    // Real-world assistance always uses Terra because it has OpenAI hosted web search.
    if (useWebSearch) {
      engine = 'openai';
      nextLock = prevEngine === 'grok' ? prevLock : nextLock;
    }
    if (engine === 'grok' && triggersGrok) systemPrompt = `${EROTIC_OVERRIDE}\n\n${systemPrompt}`;

    if (looksLikeImageRequest(message)) {
      const imageResult = await handleImageRequest({
        message,
        userId,
        supabase: req.supabase,
        llmClient: openaiClient,
        model: utilityModel,
        conversationHistory: recentChat,
        sceneContext,
      });
      if (imageResult.handled) {
        const reply = imageResult.irisMessage || '';
        await saveChatMessage(req.supabase, {
          userId,
          role: 'assistant',
          content: reply,
          imageBucket: imageResult.imageBucket || null,
          imagePath: imageResult.imagePath || null,
          clientMessageId: assistantClientMessageId(clientMessageId),
        });
        if (imageResult.imageUrl) touchLastPhotoSent(req.supabase, userId).catch(() => {});
        return res.json({
          reply,
          image_url: imageResult.imageUrl || null,
          image_bucket: imageResult.imageBucket || null,
          image_path: imageResult.imagePath || null,
          usage: { chat: chatUsage, image: imageResult.usage || null },
        });
      }
    }

    const client = getLLMClient(engine);
    const responseArgs = {
      model: MODELS[engine],
      input: [{ role: 'system', content: systemPrompt }, ...toModelHistory(recentChat), { role: 'user', content: message }],
    };
    if (engine === 'openai') {
      responseArgs.reasoning = { effort: useWebSearch ? 'low' : 'none' };
      if (useWebSearch) responseArgs.tools = [{ type: 'web_search' }];
    }

    const response = await client.responses.create(responseArgs);
    const reply = response.output_text || '…';
    await saveChatMessage(req.supabase, { userId, role: 'assistant', content: reply, clientMessageId: assistantClientMessageId(clientMessageId) });

    if (shouldPersistExchange(message, reply)) {
      autoStoreEpisodicMemoryHybrid({ supabase: req.supabase, userId, sceneKey, sceneContext, userText: message, llmReply: reply, llmClient: openaiClient, model: utilityModel })
        .catch((error) => console.log('[AUTO_MEMORY_EXCHANGE_ERROR]', error?.message));
    }
    await patchSceneContext(req.supabase, sceneKey, { last_engine: engine, engine_lock_count: nextLock, last_engine_reply: reply, interaction_mode: state });

    const governanceJobs = [];
    if (shouldRunRelationshipUpdate(message, reply)) {
      governanceJobs.push(
        inferRelationshipDelta({ userText: message, irisReply: reply, currentState: relationshipState || {}, llmClient: openaiClient, model: utilityModel }).then((delta) => Object.keys(delta).length && updateRelationshipState(req.supabase, userId, delta)),
        inferStateUpdate({ userText: message, irisReply: reply, currentState: internalState || {}, llmClient: openaiClient, model: utilityModel }).then((patch) => Object.keys(patch).length && updateInternalState(req.supabase, userId, patch)),
      );
    }
    if (shouldRunSelfAwareness(message, reply)) governanceJobs.push(runSelfAwareness({ supabase: req.supabase, userId, userText: message, irisReply: reply, llmClient: openaiClient, model: utilityModel }));
    if (shouldRunPersonalityEvolution(message)) governanceJobs.push(evolvePersonality({ supabase: req.supabase, userId, userText: message, irisReply: reply, currentEvolution: personalityEvolution, userProfile: userProfile || [], llmClient: openaiClient, model: utilityModel }));
    Promise.allSettled(governanceJobs).then((results) => {
      const failed = results.filter((item) => item.status === 'rejected');
      if (failed.length) console.log('[GOVERNANCE_UPDATE_ERRORS]', failed.length);
    });

    return res.json({ reply, usage: { chat: chatUsage } });
  } catch (error) {
    console.error('[CHAT_ERROR]', error?.message || error);
    const status = error?.message === 'usage_limit_unavailable' ? 503 : 500;
    return res.status(status).json({ error: status === 503 ? 'usage_limit_unavailable' : 'chat_failed' });
  }
});

export default router;
