import { handleImageRequest } from '../image/imageHandler.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { saveChatMessage } from '../memory/chatHistory.js';
import {
  claimScheduledAction,
  completeScheduledAction,
  failScheduledAction,
  loadDueScheduledActions,
} from './scheduledActions.js';

let timer = null;
let firstRunTimer = null;
let running = false;

function pollMs() {
  const parsed = Number(process.env.IRIS_SCHEDULED_ACTION_POLL_SECONDS || 60);
  const seconds = Number.isFinite(parsed) ? Math.max(30, Math.min(300, Math.round(parsed))) : 60;
  return seconds * 1000;
}

async function processAction(supabase, action) {
  const claimed = await claimScheduledAction(supabase, action.id);
  if (!claimed) return false;
  try {
    if (claimed.action_type !== 'image') throw new Error(`unsupported_action:${claimed.action_type}`);
    const llmClient = getLLMClient('openai');
    const model = MODELS.openaiUtility || MODELS.openai;
    const imageResult = await handleImageRequest({
      message: claimed.request_text,
      userId: claimed.user_id,
      supabase,
      llmClient,
      model,
      conversationHistory: claimed.conversation_snapshot || [],
      sceneContext: claimed.scene_context_snapshot || null,
      visualState: claimed.visual_state_snapshot || null,
      physicalIdentity: claimed.physical_identity_snapshot || null,
      activityState: claimed.activity_snapshot || null,
      visualPreferences: [],
    });

    if (!imageResult?.handled || !imageResult?.imageUrl) {
      throw new Error(imageResult?.irisMessage || 'scheduled_image_not_generated');
    }

    const saved = await saveChatMessage(supabase, {
      userId: claimed.user_id,
      role: 'assistant',
      content: imageResult.irisMessage || '📸',
      imageBucket: imageResult.imageBucket || null,
      imagePath: imageResult.imagePath || null,
      clientMessageId: `scheduled:${claimed.id}`,
    });
    if (!saved) throw new Error('scheduled_message_not_saved');
    await completeScheduledAction(supabase, claimed.id);
    console.log('[SCHEDULED_ACTION_SENT]', { id: claimed.id, userId: claimed.user_id, action: claimed.action_type });
    return true;
  } catch (error) {
    console.log('[SCHEDULED_ACTION_ERROR]', action.id, error?.message || error);
    await failScheduledAction(supabase, action.id, error?.message || error);
    return false;
  }
}

export async function runScheduledActionSweep() {
  if (running) return { skipped: 'already_running', processed: 0, sent: 0 };
  running = true;
  try {
    const supabase = getSupabaseAdmin();
    const actions = await loadDueScheduledActions(supabase, 10);
    let sent = 0;
    for (const action of actions) {
      if (await processAction(supabase, action)) sent += 1;
    }
    if (actions.length) console.log('[SCHEDULED_ACTION_SWEEP]', { processed: actions.length, sent });
    return { processed: actions.length, sent };
  } catch (error) {
    console.log('[SCHEDULED_ACTION_SWEEP_ERROR]', error?.message || error);
    return { processed: 0, sent: 0, error: error?.message || String(error) };
  } finally {
    running = false;
  }
}

export function startScheduledActionLoop() {
  if (timer || firstRunTimer) return false;
  const interval = pollMs();
  firstRunTimer = setTimeout(() => {
    firstRunTimer = null;
    runScheduledActionSweep().catch(() => {});
    timer = setInterval(() => runScheduledActionSweep().catch(() => {}), interval);
    timer.unref?.();
  }, 10000);
  firstRunTimer.unref?.();
  console.log('[SCHEDULED_ACTION_LOOP_STARTED]', { pollSeconds: interval / 1000 });
  return true;
}
