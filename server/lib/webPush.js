import crypto from 'node:crypto';
import { getSupabaseAdmin } from './supabaseAdmin.js';

const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://iris-mobile.vercel.app';

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fixed32(value) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.from(hex.padStart(64, '0'), 'hex');
}

function derivePrivateScalar(seed) {
  const digest = crypto.createHash('sha256').update('iris-web-push-v1\0').update(seed).digest();
  const value = BigInt(`0x${digest.toString('hex')}`);
  return fixed32((value % (P256_ORDER - 1n)) + 1n);
}

function rootSecret() {
  return process.env.IRIS_WEB_PUSH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function vapidKeys() {
  const seed = rootSecret();
  if (!seed) return null;

  const privateScalar = derivePrivateScalar(seed);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateScalar);
  const publicKey = ecdh.getPublicKey(null, 'uncompressed');
  const x = publicKey.subarray(1, 33);
  const y = publicKey.subarray(33, 65);
  const privateKey = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(x),
      y: base64url(y),
      d: base64url(privateScalar),
    },
    format: 'jwk',
  });

  return { publicKey: base64url(publicKey), privateKey };
}

function vapidJwt(endpoint, keys) {
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(Buffer.from(JSON.stringify({ aud: audience, exp: now + (12 * 60 * 60), sub: VAPID_SUBJECT })));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${unsigned}.${base64url(signature)}`;
}

export function getWebPushPublicKey() {
  return vapidKeys()?.publicKey || null;
}

async function sendEmptyWebPush(endpoint) {
  const keys = vapidKeys();
  if (!keys) return { ok: false, status: 503, reason: 'web_push_not_configured' };
  const token = vapidJwt(endpoint, keys);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      TTL: '120',
      Urgency: 'normal',
      Authorization: `vapid t=${token}, k=${keys.publicKey}`,
      'Content-Length': '0',
    },
  });
  return { ok: response.ok, status: response.status, reason: response.ok ? null : (await response.text()).slice(0, 180) };
}

export async function notifyWebPushReply(userId) {
  if (!userId) return;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('web_push_subscriptions')
      .select('id, endpoint')
      .eq('user_id', userId)
      .is('disabled_at', null);
    if (error) throw error;
    if (!data?.length) return;

    const now = new Date().toISOString();
    await Promise.allSettled(data.map(async (subscription) => {
      try {
        const result = await sendEmptyWebPush(subscription.endpoint);
        if (result.ok) return;
        console.log('[WEB_PUSH_SEND_FAILED]', result.status, result.reason || '');
        if (result.status === 404 || result.status === 410) {
          await admin.from('web_push_subscriptions').update({ disabled_at: now, updated_at: now }).eq('id', subscription.id);
        }
      } catch (error) {
        console.log('[WEB_PUSH_SEND_ERROR]', error?.message || error);
      }
    }));
  } catch (error) {
    console.log('[WEB_PUSH_NOTIFY_ERROR]', error?.message || error);
  }
}
