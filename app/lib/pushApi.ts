import { Platform } from 'react-native';
import { API_URL } from '../../constants/api';

async function pushRequest(accessToken: string, expoPushToken: string, method: 'POST' | 'DELETE') {
  const response = await fetch(`${API_URL}/push/register`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ expo_push_token: expoPushToken, platform: Platform.OS, device_id: null }),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

export function upsertPushTokenWithAccessToken(accessToken: string, expoPushToken: string) {
  return pushRequest(accessToken, expoPushToken, 'POST');
}

export function unregisterPushTokenWithAccessToken(accessToken: string, expoPushToken: string) {
  return pushRequest(accessToken, expoPushToken, 'DELETE');
}
