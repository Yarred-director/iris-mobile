import { notifyWebPushReply } from '../lib/webPush.js';
import { createSignedMediaUrl, isUserOwnedMediaPath } from '../media/privateMedia.js';

const DEFAULT_MODEL_HISTORY_LIMIT = 14;
const DEFAULT_CLIENT_HISTORY_LIMIT = 50;
const MAX_MESSAGE_CHARS = 4000;

function clampLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function cleanContent(value) {
  return String(value || '').trim().slice(0, MAX_MESSAGE_CHARS);
}

export async function loadRecentChatMessages(supabase, userId, limit = DEFAULT_MODEL_HISTORY_LIMIT) {
  const safeLimit = clampLimit(limit, DEFAULT_MODEL_HISTORY_LIMIT, 30);
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, image_bucket, image_path, client_message_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) {
    console.log('[CHAT_HISTORY] load error:', error.message);
    return [];
  }
  return (data || []).reverse();
}

export function toModelHistory(messages) {
  return (messages || []).map((message) => {
    const content = cleanContent(message.content);
    const imageNote = message.image_path ? '\n[An image was sent in this turn.]' : '';
    return {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: `${content}${imageNote}`.trim() || '[empty message]',
    };
  });
}

export async function saveChatMessage(supabase, { userId, role, content, imageBucket = null, imagePath = null, clientMessageId = null }) {
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
  const row = {
    user_id: userId,
    role: normalizedRole,
    content: cleanContent(content),
    image_bucket: imageBucket || null,
    image_path: imagePath || null,
    client_message_id: clientMessageId ? String(clientMessageId).slice(0, 160) : null,
  };
  const { data, error } = await supabase
    .from('chat_messages')
    .insert(row)
    .select('id, role, content, image_bucket, image_path, client_message_id, created_at')
    .maybeSingle();
  if (error) {
    if (error.code === '23505' && clientMessageId) return null;
    console.log('[CHAT_HISTORY] save error:', error.message);
    return null;
  }
  if (data && normalizedRole === 'assistant') {
    notifyWebPushReply(userId).catch((pushError) => console.log('[WEB_PUSH_AFTER_REPLY_ERROR]', pushError?.message || pushError));
  }
  return data || null;
}

async function signHistoryMessage(message, userId) {
  if (!message.image_bucket || !message.image_path) return { ...message, image_url: null };
  if (!isUserOwnedMediaPath(message.image_bucket, message.image_path, userId)) return { ...message, image_url: null };
  try {
    const imageUrl = await createSignedMediaUrl({ bucket: message.image_bucket, path: message.image_path, expiresIn: 3600 });
    return { ...message, image_url: imageUrl };
  } catch (error) {
    console.log('[CHAT_HISTORY] sign error:', error?.message);
    return { ...message, image_url: null };
  }
}

export async function listChatHistory(supabase, userId, limit = DEFAULT_CLIENT_HISTORY_LIMIT) {
  const safeLimit = clampLimit(limit, DEFAULT_CLIENT_HISTORY_LIMIT, 100);
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, image_bucket, image_path, client_message_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(error.message);
  return Promise.all((data || []).reverse().map((message) => signHistoryMessage(message, userId)));
}

export function assistantClientMessageId(clientMessageId) {
  if (!clientMessageId) return null;
  return `${String(clientMessageId).slice(0, 140)}:assistant`;
}

export async function loadExistingAssistantResponse(supabase, userId, clientMessageId) {
  const assistantId = assistantClientMessageId(clientMessageId);
  if (!assistantId) return null;
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, image_bucket, image_path, client_message_id, created_at')
    .eq('user_id', userId)
    .eq('client_message_id', assistantId)
    .maybeSingle();
  if (error) {
    console.log('[CHAT_HISTORY] idempotency lookup error:', error.message);
    return null;
  }
  return data ? signHistoryMessage(data, userId) : null;
}

export async function clearChatHistory(supabase, userId) {
  const { error } = await supabase.from('chat_messages').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
  return true;
}
