// server/push/expoPush.js
import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export async function sendExpoPush({ to, title, body, data }) {
  try {
    if (!to || !Expo.isExpoPushToken(to)) {
      return { ok: false, error: 'INVALID_EXPO_PUSH_TOKEN', details: { to } };
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
    for (const chunk of chunks) {
      const t = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...t);
    }

    const firstError = tickets.find((t) => t?.status === 'error');
    if (firstError) {
      return {
        ok: false,
        error:
          firstError?.message ||
          firstError?.details?.error ||
          'EXPO_TICKET_ERROR',
        details: { tickets },
      };
    }

    const ticketIds = tickets.map((t) => t?.id).filter(Boolean);

    return {
      ok: true,
      details: {
        tickets,
        ticketIds,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'EXPO_SEND_EXCEPTION',
      details: { raw: String(e) },
    };
  }
}