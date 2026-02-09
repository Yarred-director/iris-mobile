// server/push/expoPush.js
import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export async function sendExpoPush({ to, title, body, data }) {
  if (!Expo.isExpoPushToken(to)) {
    return { ok: false, error: 'INVALID_EXPO_TOKEN' };
  }

  const messages = [
    {
      to,
      sound: 'default',
      title: title || 'Iris',
      body: body || '',
      data: data || {},
    },
  ];

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  try {
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    // ✅ if any ticket is error → fail
    const firstError = tickets.find((t) => t && t.status === 'error');
    if (firstError) {
      return {
        ok: false,
        error: firstError?.message || 'EXPO_TICKET_ERROR',
        details: firstError?.details || null,
        tickets,
      };
    }

    return { ok: true, tickets };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), tickets };
  }
}