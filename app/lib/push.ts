import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

function projectId() {
  return Constants.easConfig?.projectId ?? (Constants.expoConfig as any)?.extra?.eas?.projectId ?? (Constants as any).manifest?.extra?.eas?.projectId ?? (Constants as any).manifest2?.extra?.eas?.projectId;
}

export async function registerForPushToken({ requestPermission = true } = {}): Promise<string | null> {
  if (!Device.isDevice) return null;
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted' && requestPermission) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  if (Device.osName === 'Android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.MAX });
  }
  const id = projectId();
  return (await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined)).data;
}

export async function getExistingPushToken(): Promise<string | null> {
  return registerForPushToken({ requestPermission: false });
}
