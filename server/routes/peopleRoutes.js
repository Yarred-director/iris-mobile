import { Router } from 'express';
import { looksLikeImageRequest } from '../memory/memoryPolicy.js';
import { requireUserId } from '../middleware/auth.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import {
  assistantClientMessageId,
  deleteUserChatMessageById,
  loadExistingAssistantResponse,
  loadRecentChatMessages,
  saveChatMessage,
} from '../memory/chatHistory.js';
import { getSceneContext, patchSceneContext } from '../memory/sceneContext.js';
import { attachChatAttachments } from '../media/chatAttachments.js';
import {
  loadPeopleDirectory,
  resolvePeopleAgentInvocation,
  runPeopleAgentExchange,
} from '../people/peopleAgents.js';
import { runWithPeopleDirectory } from '../people/peopleContext.js';
import { handlePeopleImageRequest, resolvePeopleImageTarget } from '../people/peopleImages.js';
import { classifyPeopleRelayRequest } from '../people/peopleRelay.js';

const router = Router();

function quotaResponse(res, usage) {
  return res.status(429).json({ error: 'chat_daily_limit_reached', used: usage.used, limit: usage.limit, resets_at: usage.resetsAt });
}

function visibleAgentReply(personName, reply) {
  return `${personName}:\n${String(reply || '').trim() || '…'}`;
}

// Experimental gateway. For an enabled user, the generic People directory is loaded
// once per chat request and exposed request-locally to Iris's prompt assembler.
// Direct Name/Alias addressing, person-specific image requests and explicit Iris→person
// relays are handled here. Disabled/missing schema returns an empty directory and normal
// Iris behavior continues unchanged.
router.post('/chat', async (req, res, next) => {
  const rawMessage = String(req.body?.message || '').trim();

  let rollbackUserMessage = null;
  let assistantPersisted = false;
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const directory = await loadPeopleDirectory(req.supabase, userId);
    if (!directory.length) return runWithPeopleDirectory(directory, () => next());

    // Direct addressing works with both "@Myno ..." and an unambiguous leading
    // "Myno ..." / alias. The resolver already enforces a name boundary.
    const invocation = resolvePeopleAgentInvocation(rawMessage, directory);
    const imageTarget = looksLikeImageRequest(rawMessage)
      ? resolvePeopleImageTarget(rawMessage, directory)
      : null;
    const relay = !invocation && !imageTarget
      ? await classifyPeopleRelayRequest({ text: rawMessage, directory })
      : null;

    if (!invocation && !imageTarget && !relay) {
      return runWithPeopleDirectory(directory, () => next());
    }

    const clientMessageId = req.body?.client_message_id ? String(req.body.client_message_id).slice(0, 140) : null;
    const existingResponse = await loadExistingAssistantResponse(req.supabase, userId, clientMessageId);
    if (existingResponse) {
      return res.json({
        reply: existingResponse.content || '…',
        image_url: existingResponse.image_url || null,
        image_bucket: existingResponse.image_bucket || null,
        image_path: existingResponse.image_path || null,
        speaker_name: existingResponse.speaker_name || imageTarget?.name || invocation?.person?.name || relay?.person?.name || 'Iris',
        speaker_person_id: existingResponse.speaker_person_id || imageTarget?.id || invocation?.person?.id || relay?.person?.id || null,
        idempotent_replay: true,
        experimental_feature: 'people_agents',
      });
    }

    const usage = await consumeDailyUsage(req.supabase, userId, 'chat');
    if (!usage.allowed) return quotaResponse(res, usage);

    const sceneKey = 'global';
    const sceneContext = await getSceneContext(req.supabase, sceneKey);
    const savedUserMessage = await saveChatMessage(req.supabase, {
      userId,
      role: 'user',
      content: rawMessage,
      clientMessageId,
    });
    if (savedUserMessage?.id) {
      rollbackUserMessage = { supabase: req.supabase, userId, messageId: savedUserMessage.id };
    }

    const attachmentIds = Array.isArray(req.body?.attachment_ids) ? req.body.attachment_ids : [];
    const currentAttachments = savedUserMessage?.id
      ? await attachChatAttachments({ userId, clientMessageId, attachmentIds, messageId: savedUserMessage.id })
      : [];

    if (imageTarget) {
      const recentRaw = await loadRecentChatMessages(req.supabase, userId, 10);
      const recentChat = (recentRaw || []).filter((item) => !clientMessageId || item.client_message_id !== clientMessageId);
      const imageResult = await handlePeopleImageRequest({
        message: rawMessage,
        userId,
        supabase: req.supabase,
        person: imageTarget,
        recentChat,
      });
      const reply = visibleAgentReply(imageResult.person?.name || imageTarget.name, imageResult.caption);
      const savedAssistantMessage = await saveChatMessage(req.supabase, {
        userId,
        role: 'assistant',
        content: reply,
        imageBucket: imageResult.imageBucket || null,
        imagePath: imageResult.imagePath || null,
        clientMessageId: assistantClientMessageId(clientMessageId),
        speakerPersonId: imageResult.person?.id || imageTarget.id,
        speakerName: imageResult.person?.name || imageTarget.name,
      });
      assistantPersisted = Boolean(savedAssistantMessage);

      await patchSceneContext(req.supabase, sceneKey, {
        last_engine: `people:${imageTarget.slug}:image:${imageResult.provider || 'unknown'}`,
        engine_lock_count: 0,
        last_engine_reply: reply,
        interaction_mode: 'people_image',
      });

      return res.json({
        reply,
        image_url: imageResult.imageUrl || null,
        image_bucket: imageResult.imageBucket || null,
        image_path: imageResult.imagePath || null,
        image_provider: imageResult.provider || null,
        speaker_name: imageResult.person?.name || imageTarget.name,
        speaker_person_id: imageResult.person?.id || imageTarget.id,
        speaker_slug: imageTarget.slug,
        usage: { chat: usage, image: imageResult.usage || null },
        experimental_feature: 'people_agents',
      });
    }

    if (invocation) {
      const result = await runPeopleAgentExchange({
        supabase: req.supabase,
        userId,
        invocation,
        attachments: currentAttachments,
        sceneContext: sceneContext || {},
      });
      const reply = visibleAgentReply(result.person.name, result.reply);
      const savedAssistantMessage = await saveChatMessage(req.supabase, {
        userId,
        role: 'assistant',
        content: reply,
        clientMessageId: assistantClientMessageId(clientMessageId),
        speakerPersonId: result.person.id,
        speakerName: result.person.name,
      });
      assistantPersisted = Boolean(savedAssistantMessage);

      await patchSceneContext(req.supabase, sceneKey, {
        last_engine: `people:${result.person.slug}:${result.engine}`,
        engine_lock_count: 0,
        last_engine_reply: reply,
        interaction_mode: result.interactionMode,
      });

      return res.json({
        reply,
        speaker_name: result.person.name,
        speaker_person_id: result.person.id,
        speaker_slug: result.person.slug,
        usage: { chat: usage },
        experimental_feature: 'people_agents',
      });
    }

    // Semantic relay: the user asked Iris to say/ask something TO a persistent AI
    // person. The child agent receives an explicit relay context and the returned
    // shared-chat message visibly shows both the relay and the person's answer.
    const relayInvocation = {
      person: relay.person,
      agentMessage: `[Iris relays Yarred's message] ${relay.relayMessage}`,
      matchedAlias: relay.person.name,
      explicit: true,
    };
    const result = await runPeopleAgentExchange({
      supabase: req.supabase,
      userId,
      invocation: relayInvocation,
      attachments: currentAttachments,
      sceneContext: sceneContext || {},
    });
    const reply = `Iris → ${result.person.name}: ${relay.relayMessage}\n\n${visibleAgentReply(result.person.name, result.reply)}`;
    const savedAssistantMessage = await saveChatMessage(req.supabase, {
      userId,
      role: 'assistant',
      content: reply,
      clientMessageId: assistantClientMessageId(clientMessageId),
      speakerPersonId: result.person.id,
      speakerName: result.person.name,
    });
    assistantPersisted = Boolean(savedAssistantMessage);

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: `people:relay:${result.person.slug}:${result.engine}`,
      engine_lock_count: 0,
      last_engine_reply: reply,
      interaction_mode: result.interactionMode,
    });

    return res.json({
      reply,
      speaker_name: result.person.name,
      speaker_person_id: result.person.id,
      speaker_slug: result.person.slug,
      relay: { from: 'Iris', to: result.person.name, message: relay.relayMessage },
      usage: { chat: usage },
      experimental_feature: 'people_agents',
    });
  } catch (error) {
    console.error('[PEOPLE_AGENT_CHAT_ERROR]', error?.code || error?.message || error);
    if (rollbackUserMessage && !assistantPersisted) {
      await deleteUserChatMessageById(rollbackUserMessage.supabase, rollbackUserMessage);
    }
    const status = error?.message === 'usage_limit_unavailable' ? 503 : 500;
    return res.status(status).json({ error: status === 503 ? 'usage_limit_unavailable' : 'people_agent_chat_failed' });
  }
});

export default router;
