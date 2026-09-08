import { Router } from 'express';
import { requireUserId } from '../middleware/auth.js';
import { consumeDailyUsage } from '../middleware/usageLimit.js';
import {
  assistantClientMessageId,
  deleteUserChatMessageById,
  loadExistingAssistantResponse,
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

const router = Router();

function quotaResponse(res, usage) {
  return res.status(429).json({ error: 'chat_daily_limit_reached', used: usage.used, limit: usage.limit, resets_at: usage.resetsAt });
}

// Experimental gateway. For an enabled user, the generic People directory is loaded
// once per chat request and exposed request-locally to Iris's prompt assembler. An
// explicit @Name/@Alias invokes that child agent directly. Disabled/missing schema
// returns an empty directory and normal Iris behavior continues unchanged.
router.post('/chat', async (req, res, next) => {
  const rawMessage = String(req.body?.message || '').trim();

  let rollbackUserMessage = null;
  let assistantPersisted = false;
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const directory = await loadPeopleDirectory(req.supabase, userId);
    const invocation = rawMessage.startsWith('@')
      ? resolvePeopleAgentInvocation(rawMessage, directory)
      : null;

    if (!invocation) {
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
        speaker_name: existingResponse.speaker_name || invocation.person.name,
        speaker_person_id: existingResponse.speaker_person_id || invocation.person.id,
        idempotent_replay: true,
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

    const result = await runPeopleAgentExchange({
      supabase: req.supabase,
      userId,
      invocation,
      attachments: currentAttachments,
      sceneContext: sceneContext || {},
    });

    const savedAssistantMessage = await saveChatMessage(req.supabase, {
      userId,
      role: 'assistant',
      content: result.reply,
      clientMessageId: assistantClientMessageId(clientMessageId),
      speakerPersonId: result.person.id,
      speakerName: result.person.name,
    });
    assistantPersisted = Boolean(savedAssistantMessage);

    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: `people:${result.person.slug}:${result.engine}`,
      engine_lock_count: 0,
      last_engine_reply: result.reply,
      interaction_mode: result.interactionMode,
    });

    return res.json({
      reply: result.reply,
      speaker_name: result.person.name,
      speaker_person_id: result.person.id,
      speaker_slug: result.person.slug,
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
