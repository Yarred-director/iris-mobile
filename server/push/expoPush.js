// server/push/expoPush.js
import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export async function sendExpoPush({ to, title, body, data }) {
  if (!Expo.isExpoPushToken(to)) return { ok: false, error: 'INVALID_EXPO_TOKEN' };

  const messages = [{
    to,
    sound: 'default',
    title: title || 'Iris',
    body: body || '',
    data: data || {},
  }];

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
    tickets.push(...ticketChunk);
  }

  // (optional) later: handle receipts & invalidate bad tokens
  return { ok: true, tickets };
}