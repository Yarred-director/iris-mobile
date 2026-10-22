import { Platform } from 'react-native';

// Chat history cached on the device is intimate; it never outlives the signed-in session.
const USER_CACHE_PREFIXES = ['iris.chat.history.v3:'];

export async function clearLocalUserCache(userId: string) {
  const keys = USER_CACHE_PREFIXES.map((prefix) => `${prefix}${userId}`);
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') keys.forEach((key) => window.localStorage.removeItem(key));
      return;
    }
    await (await import('@react-native-async-storage/async-storage')).default.multiRemove(keys);
  } catch {}
}
