import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '../../providers/AuthProvider';
import { registerForPushToken } from '../lib/push';
import { upsertPushTokenWithAccessToken } from '../lib/pushApi';
import { restoreWebPush } from '../lib/webPush';

export default function PushBootstrap() {
  const { accessToken } = useAuth();
  const registeredAccessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    if (Platform.OS === 'web') {
      let cancelled = false;
      const restore = async () => {
        try {
          const status = await restoreWebPush(accessToken);
          if (!cancelled && status === 'enabled') console.log('[WEB_PUSH] subscription restored');
        } catch (error: any) {
          console.log('[WEB_PUSH] restore error:', error?.message ?? String(error));
        }
      };
      void restore();
      const onVisibility = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') void restore();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', restore);
      return () => {
        cancelled = true;
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', restore);
      };
    }
    if (registeredAccessTokenRef.current === accessToken) return;
    let cancelled = false;

    const register = async () => {
      if (registeredAccessTokenRef.current === accessToken) return;
      registeredAccessTokenRef.current = accessToken;
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
    };
    void register();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        registeredAccessTokenRef.current = null;
        void register();
      }
    });

    return () => {
      cancelled = true;
      appStateSubscription.remove();
    };
  }, [accessToken]);

  return null;
}
