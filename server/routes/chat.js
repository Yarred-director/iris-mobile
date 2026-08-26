// server/routes/chat.js

import { Router } from 'express';
import { formatScheduledActionDirective, scheduleImageAction } from '../actions/scheduledActions.js';
import { assertAdultIntimacyReply } from '../behavior/adultIntimacyReplyJudge.js';
import { detectState } from '../behavior/state.js';
import { buildHeatDirective, engineForHeat, interactionModeForHeat } from '../behavior/heatRouting.js';
import { classifyIntimacyRoute } from '../behavior/intimacyRouter.js';
import { intentJudgeLLM } from '../behavior/intentJudge.js';
import { loadCognitiveContinuity, reflectOnExchange } from '../cognition/cognitiveEngine.js';
import { looksLikeFactualQuestion } from '../helpers/factualDetector.js';
import { buildLiveAssistanceDirective, looksLikeLiveAssistanceRequest } from '../helpers/liveAssistance.js';
import { buildExactLinkDirective, extractHttpUrls } from '../helpers/linkAccess.js';
import { assemblePrompt } from '../helpers/promptAssembler.js';
import { handleImageRequest } from '../image/imageHandler.js';
import { createValidatedAssistantReply, safeAssistantText } from '../lib/assistantReplyGuard.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { requireUserId } from '../middleware/auth.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import { loadActivityState, persistActivityStateSignal } from '../memory/activityContinuity.js';
import { applySubjectLock } from '../memory/subjectLock.js';
import { assistantClientMessageId, deleteUserChatMessageById, loadExistingAssistantResponse, loadRecentChatMessages, saveChatMessage, toModelHistory } from '../memory/chatHistory.js';
import { persistCompanionSignals } from '../memory/companionPreferences.js';
import { extractContextFromText } from '../memory/contextJudge.js';
import { createEmbedding } from '../memory/embeddings.js';
import { autoStoreEpisodicMemoryHybrid } from '../memory/episodicAutoStore.js';
import { loadInternalState, updateInternalState, inferStateUpdate } from '../memory/internalState.js';
import { maybeRunDecay } from '../memory/memoryDecay.js';
import { couldBeFactualQuestion, looksLikeImageRequest, shouldExtractSceneContext, shouldPersistExchange, shouldRunPersonalityEvolution, shouldRunRelationshipUpdate, shouldRunSelfAwareness, shouldRunSemanticRecall } from '../memory/memoryPolicy.js';
import { loadPersonalityEvolution } from '../memory/personalityEvolution.js';
import { bootstrapPhysicalIdentityFromUserHistory, loadPhysicalIdentity, persistPhysicalIdentitySignal } from '../memory/physicalIdentity.js';
import { loadCoreOrigin, loadSummaries, recallEpisodicMemory, recallSharedExperiences, loadUserProfile } from '../memory/recall.js';
import { loadRelationshipState, updateRelationshipState, inferRelationshipDelta } from '../memory/relationshipTimeline.js';
import { getSceneContext, patchSceneContext } from '../memory/sceneContext.js';
import { getSceneFacts } from '../memory/sceneFacts.js';
import { loadSelfModel } from '../memory/selfAwareness.js';
import { beginOrTouchTemporalSession, touchLastPhotoSent } from '../memory/timeContext.js';
import { loadVisualState, persistVisualSignals, selectPotentialVisualPreferences } from '../memory/visualState.js';
import { attachChatAttachments, discardChatAttachments, prepareChatAttachments } from '../media/chatAttachments.js';

const router = Router();
const MAX_USER_MESSAGE_CHARS = 8000;

function quotaResponse(res, usage, kind) {
  return res.status(429).json({ error: `${kind}_daily_limit_reached`, used: usage.used, limit: usage.limit, resets_at: usage.resetsAt });
}

function buildVisualMemoryHints(sharedExperiences, episodicRecall) {
  const hints = [];
  for (const memory of episodicRecall?.memories || []) {
    if (memory?.narrative) hints.push(memory.narrative);
  }
  for (const experience of sharedExperiences || []) {
    if (experience?.summary) hints.push(experience.summary);
    else if (experience?.full_narrative) hints.push(experience.full_narrative);
  }
  return hints.slice(0, 6);
}

function imageVisualPreferences(intent) {
  const values = [];
  for (const item of intent?.relevant_visual_preferences || []) {
    const value = String(item || '').trim();
    if (value) values.push(value);
  }
  for (const item of intent?.visual_preference_updates || []) {
    if (Number(item?.confidence || 0) < 0.75) continue;
    const value = String(item?.fact_value || '').trim();
    if (value) values.push(value);
  }
  return [...new Set(values)].slice(0, 8);
}

function shouldRunCognitiveReflection(userText, irisReply) {
  return shouldPersistExchange(userText, irisReply)
    || shouldRunSelfAwareness(userText, irisReply)
    || shouldRunPersonalityEvolution(userText);
}

router.post('/chat/attachments/prepare', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const attachments = await prepareChatAttachments({
      userId,
      clientMessageId: req.body?.client_message_id,
      files: req.body?.files,
    });
    return res.json({ attachments, expires_in_seconds: 7200 });
  } catch (error) {
    console.error('[CHAT_ATTACHMENT_PREPARE_ERROR]', error?.code || error?.message || error);
    const clientError = ['invalid_client_message_id', 'invalid_attachment_count', 'unsupported_attachment_type', 'invalid_attachment_size'].includes(error?.code || error?.message);
    return res.status(clientError ? 400 : 500).json({ error: clientError ? (error?.code || error?.message) : 'attachment_prepare_failed' });
  }
});

router.delete('/chat/attachments', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const deleted = await discardChatAttachments({
      userId,
      clientMessageId: req.body?.client_message_id || null,
      attachmentIds: req.body?.attachment_ids || [],
    });
    return res.json({ ok: true, deleted });
  } catch (error) {
    console.error('[CHAT_ATTACHMENT_DELETE_ERROR]', error?.code || error?.message || error);
    return res.status(500).json({ error: 'attachment_delete_failed' });
  }
});

router.post('/chat', async (req, res) => {
  let rollbackUserMessage = null;
  let assistantPersisted = false;
  try {
    const rawMessage = String(req.body?.message || '').trim();
    const attachmentIds = Array.isArray(req.body?.attachment_ids) ? req.body.attachment_ids : [];
    if (!rawMessage && !attachmentIds.length) return res.json({ reply: '…' });
    const message = rawMessage || 'Pozri sa na priložený obrázok a reaguj naň prirodzene.';
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
    const providedUrls = extractHttpUrls(message);
    const liveAssistanceRequested = looksLikeLiveAssistanceRequest(message) || providedUrls.length > 0;
    // A photo plus words such as "fotka" normally asks Iris to inspect the attachment,
    // not to launch the separate Iris-photo generation pipeline.
    const imageRequested = attachmentIds.length === 0 && looksLikeImageRequest(message);
    const factualTask = (couldBeFactualQuestion(message) || liveAssistanceRequested)
      ? looksLikeFactualQuestion(message, openaiClient, utilityModel)
      : Promise.resolve(false);

    const [
      sceneFacts,
      coreOrigin,
      summaries,
      userProfile,
      currentVisualState,
      currentPhysicalIdentity,
      currentActivityState,
      sharedExperiences,
      episodicRecall,
      isFactual,
      relationshipState,
      internalState,
      selfModel,
      personalityEvolution,
      cognitiveContinuity,
      recentChatRaw,
    ] = await Promise.allSettled([
      getSceneFacts(req.supabase, userId, sceneKey, 'global'),
      loadCoreOrigin(req.supabase),
      loadSummaries(req.supabase),
      loadUserProfile(req.supabase, userId),
      loadVisualState(req.supabase, userId, sceneKey),
      loadPhysicalIdentity(req.supabase, userId),
      loadActivityState(req.supabase, userId),
      recallSharedTask,
      recallEpisodicTask,
      factualTask,
      loadRelationshipState(req.supabase, userId),
      loadInternalState(req.supabase, userId),
      loadSelfModel(req.supabase, userId),
      loadPersonalityEvolution(req.supabase, userId),
      loadCognitiveContinuity(req.supabase, userId),
      loadRecentChatMessages(req.supabase, userId, 14),
    ]).then((results) => results.map((item) => item.status === 'fulfilled' ? item.value : null));

    const recentChat = (recentChatRaw || []).filter((item) => !clientMessageId || item.client_message_id !== clientMessageId);
    const savedUserMessage = await saveChatMessage(req.supabase, { userId, role: 'user', content: rawMessage, clientMessageId });
    if (savedUserMessage?.id) {
      rollbackUserMessage = { supabase: req.supabase, userId, messageId: savedUserMessage.id };
    }
    const currentAttachments = savedUserMessage?.id
      ? await attachChatAttachments({ userId, clientMessageId, attachmentIds, messageId: savedUserMessage.id })
      : [];

    const resolvedPhysicalIdentity = await bootstrapPhysicalIdentityFromUserHistory({
      supabase: req.supabase,
      userId,
      currentPhysicalIdentity,
      latestUserText: message,
      llmClient: openaiClient,
      model: utilityModel,
    });

    const state = detectState(message);
    const visualPreferenceFacts = selectPotentialVisualPreferences(userProfile || []);
    const visualMemoryHints = buildVisualMemoryHints(sharedExperiences, episodicRecall);
    const [intent, intimacyRoute] = await Promise.all([
      intentJudgeLLM({
        text: message,
        sceneContext: sceneContext || {},
        conversationHistory: recentChat,
        currentVisualState,
        currentPhysicalIdentity: resolvedPhysicalIdentity,
        currentActivityState,
        visualPreferenceFacts,
        memoryHints: visualMemoryHints,
        isImageRequest: imageRequested,
      }),
      classifyIntimacyRoute({
        text: message,
        sceneContext: sceneContext || {},
        conversationHistory: recentChat,
      }),
    ]);

    intent.heat_level = intimacyRoute.heat_level;
    intent.intensity_style = intimacyRoute.intensity_style;
    intent.continues_intimate_scene = intimacyRoute.continues_intimate_scene;

    if (state === 'heated' && intimacyRoute.heat_level === 0) {
      const routeError = new Error('intimacy_route_inconsistent');
      routeError.code = 'intimacy_route_inconsistent';
      throw routeError;
    }

    const [visualState, physicalIdentity, activityState] = await Promise.all([
      persistVisualSignals({
        supabase: req.supabase,
        userId,
        sceneKey,
        intent,
        currentVisualState,
      }),
      persistPhysicalIdentitySignal({
        supabase: req.supabase,
        userId,
        intent,
        currentPhysicalIdentity: resolvedPhysicalIdentity,
      }),
      persistActivityStateSignal({
        supabase: req.supabase,
        userId,
        intent,
        currentActivityState,
      }),
    ]);

    persistCompanionSignals({ supabase: req.supabase, userId, intent })
      .catch((error) => console.log('[COMPANION_PREF_ERROR]', error?.message));

    const heatLevel = Number.isInteger(intent?.heat_level) ? intent.heat_level : 0;
    const requestedWebSearch = Boolean(liveAssistanceRequested || isFactual);
    const useWebSearch = requestedWebSearch;
    const engine = engineForHeat(heatLevel, { useWebSearch });

    let systemPrompt = assemblePrompt({
      sceneFacts,
      sceneContext,
      visualState,
      physicalIdentity,
      activityState,
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
      cognitiveContinuity,
      isFactual: Boolean(isFactual && heatLevel < 2 && !useWebSearch),
    });
    if (useWebSearch) systemPrompt = `${systemPrompt}\n\n${buildLiveAssistanceDirective(sceneContext)}`;
    if (providedUrls.length) systemPrompt = `${systemPrompt}\n\n${buildExactLinkDirective(providedUrls)}`;
    systemPrompt = `${systemPrompt}\n\n${buildHeatDirective({ heatLevel, intensityStyle: intent?.intensity_style })}`;

    let scheduledAction = null;
    let imageDeliveryMode = imageRequested ? (intent?.image_delivery_mode || 'immediate') : 'none';
    if (imageRequested && imageDeliveryMode === 'scheduled') {
      try {
        scheduledAction = await scheduleImageAction({
          supabase: req.supabase,
          userId,
          delayMinutes: intent?.image_delay_minutes || 20,
          requestText: message,
          conversationHistory: recentChat,
          visualState,
          physicalIdentity,
          activityState,
          sceneContext,
        });
        systemPrompt = `${systemPrompt}\n\n${formatScheduledActionDirective(scheduledAction)}`;
      } catch (error) {
        console.log('[SCHEDULE_IMAGE_ERROR]', error?.message);
        imageDeliveryMode = 'immediate';
      }
    }

    if (imageRequested && imageDeliveryMode === 'immediate') {
      const imageResult = await handleImageRequest({
        message,
        userId,
        supabase: req.supabase,
        llmClient: openaiClient,
        model: utilityModel,
        conversationHistory: recentChat,
        sceneContext,
        visualState,
        physicalIdentity,
        activityState,
        visualPreferences: imageVisualPreferences(intent),
      });
      if (imageResult.handled) {
        const reply = safeAssistantText(imageResult.irisMessage, imageResult.imageUrl ? '📸' : 'Ojoj, niečo sa pokazilo 🙈 Skús znova o chvíľu!');
        const savedAssistantMessage = await saveChatMessage(req.supabase, {
          userId,
          role: 'assistant',
          content: reply,
          imageBucket: imageResult.imageBucket || null,
          imagePath: imageResult.imagePath || null,
          clientMessageId: assistantClientMessageId(clientMessageId),
        });
        assistantPersisted = Boolean(savedAssistantMessage);
        await patchSceneContext(req.supabase, sceneKey, {
          last_engine: 'image',
          engine_lock_count: 0,
          interaction_mode: interactionModeForHeat(heatLevel, state),
        });
        if (imageResult.imageUrl) touchLastPhotoSent(req.supabase, userId).catch(() => {});

        if (reply && shouldRunCognitiveReflection(message, reply)) {
          reflectOnExchange({
            supabase: req.supabaseAdmin,
            userId,
            userText: message,
            irisReply: reply,
            sceneContext,
            userProfile: userProfile || [],
            relationshipState: relationshipState || {},
            selfModel,
            personalityEvolution,
            cognitiveContinuity,
            llmClient: openaiClient,
            model: utilityModel,
          }).catch((error) => console.log('[COGNITION_IMAGE_REFLECTION_ERROR]', error?.message));
        }

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
    const currentUserInput = currentAttachments.length
      ? {
          role: 'user',
          content: [
            { type: 'input_text', text: message },
            ...currentAttachments.map((attachment) => ({ type: 'input_image', image_url: attachment.image_url, detail: 'auto' })),
          ],
        }
      : { role: 'user', content: message };
    const responseArgs = {
      model: MODELS[engine],
      input: [{ role: 'system', content: systemPrompt }, ...toModelHistory(recentChat), currentUserInput],
    };
    if (engine === 'openai') {
      responseArgs.reasoning = { effort: useWebSearch ? 'low' : 'none' };
      if (useWebSearch) responseArgs.tools = [{ type: 'web_search' }];
    } else if (engine === 'grok') {
      responseArgs.reasoning = { effort: 'low' };
      if (useWebSearch) responseArgs.tools = [{ type: 'web_search' }];
    }

    const validateReply = heatLevel >= 2
      ? (candidate) => assertAdultIntimacyReply({ userText: message, reply: candidate })
      : null;
    const reply = await createValidatedAssistantReply({ client, responseArgs, engine, validateReply });
    const savedAssistantMessage = await saveChatMessage(req.supabase, { userId, role: 'assistant', content: reply, clientMessageId: assistantClientMessageId(clientMessageId) });
    assistantPersisted = Boolean(savedAssistantMessage);

    const persistExchange = shouldPersistExchange(message, reply);
    if (persistExchange) {
      autoStoreEpisodicMemoryHybrid({ supabase: req.supabase, userId, sceneKey, sceneContext, userText: message, llmReply: reply, llmClient: openaiClient, model: utilityModel })
        .catch((error) => console.log('[AUTO_MEMORY_EXCHANGE_ERROR]', error?.message));
    }
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: scheduledAction ? 'scheduled_action' : engine,
      engine_lock_count: 0,
      last_engine_reply: reply,
      interaction_mode: interactionModeForHeat(heatLevel, state),
    });

    const governanceJobs = [];
    if (shouldRunRelationshipUpdate(message, reply)) {
      governanceJobs.push(
        inferRelationshipDelta({ userText: message, irisReply: reply, currentState: relationshipState || {}, llmClient: openaiClient, model: utilityModel }).then((delta) => Object.keys(delta).length && updateRelationshipState(req.supabase, userId, delta)),
        inferStateUpdate({ userText: message, irisReply: reply, currentState: internalState || {}, llmClient: openaiClient, model: utilityModel }).then((patch) => Object.keys(patch).length && updateInternalState(req.supabase, userId, patch)),
      );
    }
    if (persistExchange || shouldRunSelfAwareness(message, reply) || shouldRunPersonalityEvolution(message)) {
      governanceJobs.push(reflectOnExchange({
        supabase: req.supabaseAdmin,
        userId,
        userText: message,
        irisReply: reply,
        sceneContext,
        userProfile: userProfile || [],
        relationshipState: relationshipState || {},
        selfModel,
        personalityEvolution,
        cognitiveContinuity,
        llmClient: openaiClient,
        model: utilityModel,
      }));
    }
    Promise.allSettled(governanceJobs).then((results) => {
      const failed = results.filter((item) => item.status === 'rejected');
      if (failed.length) console.log('[GOVERNANCE_UPDATE_ERRORS]', failed.length);
    });

    return res.json({
      reply,
      scheduled_action: scheduledAction ? { type: 'image', due_at: scheduledAction.due_at } : null,
      usage: { chat: chatUsage },
    });
  } catch (error) {
    console.error('[CHAT_ERROR]', error?.message || error);
    if (rollbackUserMessage && !assistantPersisted) {
      await deleteUserChatMessageById(rollbackUserMessage.supabase, rollbackUserMessage);
    }

    const errorCode = error?.code || error?.message || '';
    if (String(errorCode).startsWith('intimacy_route_')) {
      return res.status(503).json({ error: 'routing_unavailable' });
    }
    if (String(errorCode).startsWith('assistant_reply_')) {
      return res.status(502).json({ error: 'invalid_model_output' });
    }
    const status = error?.message === 'usage_limit_unavailable' ? 503 : 500;
    return res.status(status).json({ error: status === 503 ? 'usage_limit_unavailable' : 'chat_failed' });
  }
});

export default router;
