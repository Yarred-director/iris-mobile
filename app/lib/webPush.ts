import { Platform } from 'react-native';

export type WebPushStatus = 'unsupported' | 'needs_home_screen' | 'blocked' | 'disabled' | 'enabled';

function apiBase() {
  return (process.env.EXPO_PUBLIC_API_URL ?? 'https://iris-mobile.onrender.com').trim().replace(/\/+$/, '').replace(/\/chat$/, '');
}

function isIosLike() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || Boolean((navigator as any).standalone);
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function serviceWorkerRegistration() {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return registration;
}

async function registerSubscriptionWithBackend(accessToken: string, subscription: PushSubscription) {
  const response = await fetch(`${apiBase()}/push/web/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new Error(`Push registration failed (${response.status}).`);
}

async function ensureWebPushSubscription(accessToken: string, createIfMissing: boolean): Promise<WebPushStatus> {
  const registration = await serviceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription && createIfMissing) {
    const keyResponse = await fetch(`${apiBase()}/push/web/public-key`);
    if (!keyResponse.ok) throw new Error('Web push public key is unavailable.');
    const payload = await keyResponse.json();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(String(payload?.public_key || '')),
    });
  }
  if (!subscription) return 'disabled';
  await registerSubscriptionWithBackend(accessToken, subscription);
  return 'enabled';
}

export async function getWebPushStatus(accessToken?: string | null): Promise<WebPushStatus> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (isIosLike() && !isStandalone()) return 'needs_home_screen';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'disabled';
  try {
    const registration = await serviceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return 'disabled';
    if (accessToken) await registerSubscriptionWithBackend(accessToken, subscription);
    return 'enabled';
  } catch {
    return 'disabled';
  }
}

export async function restoreWebPush(accessToken: string): Promise<WebPushStatus> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (isIosLike() && !isStandalone()) return 'needs_home_screen';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'disabled';
  return ensureWebPushSubscription(accessToken, true);
}

export async function enableWebPush(accessToken: string): Promise<WebPushStatus> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (isIosLike() && !isStandalone()) return 'needs_home_screen';

  // On iOS the permission request must happen directly from the user's tap.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'disabled';

  return ensureWebPushSubscription(accessToken, true);
}

export function listenForWebPushReply(callback: () => void) {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'IRIS_REPLY_READY') callback();
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
