import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { createSignedMediaUrl } from './privateMedia.js';

export const CHAT_ATTACHMENT_BUCKET = 'iris-photos';
export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const TEMPORARY_ATTACHMENT_DAYS = 30;

const CONTENT_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

function attachmentError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeClientMessageId(value) {
  const id = String(value || '').trim().slice(0, 140);
  if (!/^[a-zA-Z0-9:_-]{8,140}$/.test(id)) throw attachmentError('invalid_client_message_id');
  return id;
}

function normalizeDescriptor(value) {
  const contentType = String(value?.content_type || '').toLowerCase().split(';')[0].trim();
  const byteSize = Number(value?.byte_size || 0);
  const retention = value?.retention === 'user_appearance' ? 'user_appearance' : 'temporary';
  if (!CONTENT_TYPES[contentType]) throw attachmentError('unsupported_attachment_type');
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_CHAT_ATTACHMENT_BYTES) {
    throw attachmentError('invalid_attachment_size');
  }
  return { contentType, byteSize, retention, extension: CONTENT_TYPES[contentType] };
}

function normalizeAttachmentIds(values) {
  if (!Array.isArray(values)) return [];
  const ids = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length > MAX_CHAT_ATTACHMENTS || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw attachmentError('invalid_attachment_ids');
  }
  return ids;
}

function pendingExpiry() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
}

function attachedExpiry(retention) {
  if (retention === 'user_appearance') return null;
  return new Date(Date.now() + TEMPORARY_ATTACHMENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function prepareChatAttachments({ userId, clientMessageId, files }) {
  if (!userId) throw attachmentError('user_required');
  const safeClientMessageId = normalizeClientMessageId(clientMessageId);
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_CHAT_ATTACHMENTS) {
    throw attachmentError('invalid_attachment_count');
  }

  const admin = getSupabaseAdmin();
  const rows = files.map((file) => {
    const descriptor = normalizeDescriptor(file);
    const id = randomUUID();
    return {
      id,
      user_id: userId,
      message_id: null,
      client_message_id: safeClientMessageId,
      bucket: CHAT_ATTACHMENT_BUCKET,
      path: `chat/${userId}/${safeClientMessageId}/${id}.${descriptor.extension}`,
      content_type: descriptor.contentType,
      byte_size: descriptor.byteSize,
      retention: descriptor.retention,
      status: 'pending',
      expires_at: pendingExpiry(),
    };
  });

  const { error: insertError } = await admin.from('chat_attachments').insert(rows);
  if (insertError) throw attachmentError('attachment_prepare_failed');

  try {
    const uploads = await Promise.all(rows.map(async (row) => {
      const { data, error } = await admin.storage.from(row.bucket).createSignedUploadUrl(row.path, { upsert: false });
      if (error || !data?.token) throw attachmentError('signed_upload_failed');
      return {
        id: row.id,
        bucket: row.bucket,
        path: row.path,
        token: data.token,
        content_type: row.content_type,
        retention: row.retention,
      };
    }));
    return uploads;
  } catch (error) {
    await admin.from('chat_attachments').delete().eq('user_id', userId).eq('client_message_id', safeClientMessageId);
    throw error;
  }
}

async function verifyStoredAttachment(admin, row) {
  const { data, error } = await admin.storage.from(row.bucket).info(row.path);
  if (error || !data) throw attachmentError('attachment_upload_missing');
  const storedType = String(data.contentType || data.metadata?.mimetype || '').toLowerCase().split(';')[0];
  const storedSize = Number(data.size || data.metadata?.size || 0);
  if (storedType && storedType !== row.content_type) throw attachmentError('attachment_type_mismatch');
  if (!Number.isFinite(storedSize) || storedSize < 1 || storedSize > MAX_CHAT_ATTACHMENT_BYTES) {
    throw attachmentError('attachment_size_mismatch');
  }
  if (storedSize !== row.byte_size) throw attachmentError('attachment_size_mismatch');
}

export async function attachChatAttachments({ userId, clientMessageId, attachmentIds, messageId }) {
  const ids = normalizeAttachmentIds(attachmentIds);
  if (!ids.length) return [];
  const safeClientMessageId = normalizeClientMessageId(clientMessageId);
  if (!messageId) throw attachmentError('message_required');
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('chat_attachments')
    .select('id, user_id, message_id, client_message_id, bucket, path, content_type, byte_size, retention, status, expires_at, created_at')
    .eq('user_id', userId)
    .eq('client_message_id', safeClientMessageId)
    .in('id', ids);
  if (error || !rows || rows.length !== ids.length) throw attachmentError('attachment_not_found');
  if (rows.some((row) => row.status !== 'pending' || row.message_id)) throw attachmentError('attachment_already_used');

  await Promise.all(rows.map((row) => verifyStoredAttachment(admin, row)));
  const now = new Date().toISOString();
  for (const row of rows) {
    const { data: updated, error: updateError } = await admin
      .from('chat_attachments')
      .update({
        message_id: messageId,
        status: 'attached',
        attached_at: now,
        expires_at: attachedExpiry(row.retention),
      })
      .eq('id', row.id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .is('message_id', null)
      .select('id')
      .maybeSingle();
    if (updateError || !updated) throw attachmentError('attachment_claim_conflict');
  }

  return Promise.all(rows.map(async (row) => ({
    ...row,
    status: 'attached',
    message_id: messageId,
    expires_at: attachedExpiry(row.retention),
    image_url: await createSignedMediaUrl({ bucket: row.bucket, path: row.path, expiresIn: 3600 }),
  })));
}

export async function discardChatAttachments({ userId, clientMessageId = null, attachmentIds = [], pendingOnly = true }) {
  if (!userId) return 0;
  const ids = normalizeAttachmentIds(attachmentIds);
  const admin = getSupabaseAdmin();
  let query = admin.from('chat_attachments').select('id, bucket, path').eq('user_id', userId);
  if (pendingOnly) query = query.eq('status', 'pending').is('message_id', null);
  if (ids.length) query = query.in('id', ids);
  else if (clientMessageId) query = query.eq('client_message_id', normalizeClientMessageId(clientMessageId));
  else return 0;
  const { data: rows, error } = await query;
  if (error || !rows?.length) return 0;
  const paths = rows.filter((row) => row.bucket === CHAT_ATTACHMENT_BUCKET).map((row) => row.path);
  if (paths.length) {
    const { error: removeError } = await admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove(paths);
    if (removeError) throw attachmentError('attachment_storage_delete_failed');
  }
  const rowIds = rows.map((row) => row.id);
  const { error: deleteError } = await admin.from('chat_attachments').delete().eq('user_id', userId).in('id', rowIds);
  if (deleteError) throw attachmentError('attachment_metadata_delete_failed');
  return rowIds.length;
}

export async function loadAttachmentsForMessages({ userId, messageIds }) {
  const ids = [...new Set((messageIds || []).map((value) => String(value || '')).filter(Boolean))];
  if (!userId || !ids.length) return new Map();
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('chat_attachments')
    .select('id, message_id, bucket, path, content_type, byte_size, retention, expires_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'attached')
    .in('message_id', ids)
    .order('created_at', { ascending: true });
  if (error || !rows?.length) return new Map();
  const now = Date.now();
  const valid = rows.filter((row) => !row.expires_at || Date.parse(row.expires_at) > now);
  const signed = (await Promise.all(valid.map(async (row) => {
    try {
      return { ...row, image_url: await createSignedMediaUrl({ bucket: row.bucket, path: row.path, expiresIn: 3600 }) };
    } catch (error) {
      console.log('[CHAT_ATTACHMENT_SIGN_ERROR]', { id: row.id, message: error?.message || String(error) });
      return null;
    }
  }))).filter(Boolean);
  const byMessage = new Map();
  for (const attachment of signed) {
    const current = byMessage.get(attachment.message_id) || [];
    current.push(attachment);
    byMessage.set(attachment.message_id, current);
  }
  return byMessage;
}

export async function deleteTemporaryAttachmentsForUser(userId) {
  if (!userId) return 0;
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('chat_attachments')
    .select('id, bucket, path')
    .eq('user_id', userId)
    .eq('retention', 'temporary');
  if (error || !rows?.length) return 0;
  const paths = rows.map((row) => row.path);
  for (let index = 0; index < paths.length; index += 1000) {
    const { error: removeError } = await admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove(paths.slice(index, index + 1000));
    if (removeError) throw attachmentError('attachment_storage_delete_failed');
  }
  const { error: deleteError } = await admin.from('chat_attachments').delete().eq('user_id', userId).eq('retention', 'temporary');
  if (deleteError) throw attachmentError('attachment_metadata_delete_failed');
  return rows.length;
}

export async function deleteAttachmentsForMessage({ userId, messageId }) {
  if (!userId || !messageId) return 0;
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('chat_attachments')
    .select('id, bucket, path')
    .eq('user_id', userId)
    .eq('message_id', messageId);
  if (error || !rows?.length) return 0;
  const paths = rows.map((row) => row.path);
  const { error: removeError } = await admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove(paths);
  if (removeError) throw attachmentError('attachment_storage_delete_failed');
  const { error: deleteError } = await admin.from('chat_attachments').delete().eq('user_id', userId).eq('message_id', messageId);
  if (deleteError) throw attachmentError('attachment_metadata_delete_failed');
  return rows.length;
}
