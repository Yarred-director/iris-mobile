import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '../../providers/AuthProvider';
import { registerForPushToken } from '../lib/push';
import { upsertPushTokenWithAccessToken } from '../lib/pushApi';

export default function PushBootstrap() {
  const { accessToken } = useAuth();
  const registeredAccessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !accessToken) return;
    if (registeredAccessTokenRef.current === accessToken) return;
    let cancelled = false;
    registeredAccessTokenRef.current = accessToken;

    (async () => {
      try {
        const token = await registerForPushToken();
        if (!token || cancelled) return;
        const result = await upsertPushTokenWithAccessToken(accessToken, token);
        if (!result.ok) {
          console.log('[PUSH] register failed:', result.status, result.text.slice(0, 160));
          registeredAccessTokenRef.current = null;
        }
      } catch (error: any) {
        console.log('[PUSH] bootstrap error:', error?.message ?? String(error));
        registeredAccessTokenRef.current = null;
      }
    })();

    return () => { cancelled = true; };
  }, [accessToken]);

  return null;
}
