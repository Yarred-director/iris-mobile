import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

const PRIVATE_BUCKETS = new Set(['iris-photos', 'iris-ref', 'iris-temp']);
const DEFAULT_SIGNED_URL_SECONDS = 24 * 60 * 60;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function normalizePath(path) {
  return String(path || '').split('/').filter(Boolean).join('/');
}

function clampSignedUrlSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNED_URL_SECONDS;
  return Math.max(60, Math.min(Math.floor(parsed), 24 * 60 * 60));
}

function contentTypeInfo(contentType = '') {
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (normalized === 'image/webp') {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return { contentType: 'image/png', extension: 'png' };
}

export function parseSupabaseStorageObjectUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

export function isPrivateMediaBucket(bucket) {
  return PRIVATE_BUCKETS.has(String(bucket || ''));
}

export function isUserOwnedMediaPath(bucket, path, userId) {
  if (bucket !== 'iris-photos' || !userId) return false;
  const parts = normalizePath(path).split('/');
  return parts.length >= 3 && ['generated', 'iris-ref'].includes(parts[0]) && parts[1] === userId;
}

export async function createSignedMediaUrl({ bucket, path, expiresIn = DEFAULT_SIGNED_URL_SECONDS }) {
  const safeBucket = String(bucket || '');
  const safePath = normalizePath(path);
  if (!isPrivateMediaBucket(safeBucket) || !safePath) throw new Error('Invalid private media location');

  const { data, error } = await getSupabaseAdmin().storage
    .from(safeBucket)
    .createSignedUrl(safePath, clampSignedUrlSeconds(expiresIn));
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not create signed media URL');
  return data.signedUrl;
}

export async function createUserSignedMediaUrl({ bucket, path, userId, expiresIn }) {
  if (!isUserOwnedMediaPath(bucket, path, userId)) throw new Error('Forbidden media path');
  return createSignedMediaUrl({ bucket, path, expiresIn });
}

export async function persistRemoteImage({ sourceUrl, userId, bucket = 'iris-photos', prefix = 'generated', contentType: hintedContentType = null, signedUrlSeconds = DEFAULT_SIGNED_URL_SECONDS }) {
  if (!sourceUrl || !userId) throw new Error('sourceUrl and userId are required');
  if (bucket !== 'iris-photos') throw new Error('Unsupported persistence bucket');

  const timeoutMs = Math.max(10000, Math.min(Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 90000), 180000));
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_BYTES) throw new Error('Generated image exceeds 10 MB');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('Generated image exceeds 10 MB');

  const type = contentTypeInfo(hintedContentType || response.headers.get('content-type') || 'image/png');
  const safePrefix = prefix === 'iris-ref' ? 'iris-ref' : 'generated';
  const path = `${safePrefix}/${userId}/${Date.now()}-${randomUUID()}.${type.extension}`;
  const { error } = await getSupabaseAdmin().storage.from(bucket).upload(path, new Uint8Array(buffer), {
    contentType: type.contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw new Error(error.message);
  const imageUrl = await createSignedMediaUrl({ bucket, path, expiresIn: signedUrlSeconds });
  return { imageUrl, imageBucket: bucket, imagePath: path };
}

export async function persistBase64Image({ base64, userId, bucket = 'iris-photos', prefix = 'generated', contentType = 'image/png', signedUrlSeconds = DEFAULT_SIGNED_URL_SECONDS }) {
  if (!base64 || !userId) throw new Error('base64 and userId are required');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Generated image exceeds 10 MB');
  const type = contentTypeInfo(contentType);
  const safePrefix = prefix === 'iris-ref' ? 'iris-ref' : 'generated';
  const path = `${safePrefix}/${userId}/${Date.now()}-${randomUUID()}.${type.extension}`;
  const { error } = await getSupabaseAdmin().storage.from(bucket).upload(path, bytes, {
    contentType: type.contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw new Error(error.message);
  const imageUrl = await createSignedMediaUrl({ bucket, path, expiresIn: signedUrlSeconds });
  return { imageUrl, imageBucket: bucket, imagePath: path };
}
