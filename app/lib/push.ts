import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

export async function registerForPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  if (Device.osName === "Android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  // projectId fallback (Expo SDK rozdiely medzi dev/standalone)
  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any).manifest?.extra?.eas?.projectId ??
    (Constants as any).manifest2?.extra?.eas?.projectId;

  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  return token.data;
}