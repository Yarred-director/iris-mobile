// app/lib/push.ts
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export async function registerForPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // push token na emulátore často nedáva zmysel

  // iOS/Android permission
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }

  if (status !== 'granted') return null;

  // Android channel (bez toho vie byť ticho)
  if (Device.osName === 'Android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}