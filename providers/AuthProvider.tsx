import { supabase } from '@/lib/supabase';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { getExistingPushToken } from '../app/lib/push';
import { unregisterPushTokenWithAccessToken } from '../app/lib/pushApi';

type AuthCtx = {
  user: any | null;
  session: any | null;
  loading: boolean;
  accessToken: string | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn('getSession error:', error.message);
    setSession(data.session ?? null);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) console.warn('getSession error:', error.message);
      setSession(data.session ?? null);
      setLoading(false);
    })();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    user: session?.user ?? null,
    session,
    loading,
    accessToken: session?.access_token ?? null,
    signOut: async () => {
      const accessToken = session?.access_token ?? null;
      if (Platform.OS !== 'web' && accessToken) {
        try {
          const pushToken = await getExistingPushToken();
          if (pushToken) await unregisterPushTokenWithAccessToken(accessToken, pushToken);
        } catch (error: any) {
          console.log('[PUSH] unregister before sign-out failed:', error?.message ?? String(error));
        }
      }
      await supabase.auth.signOut();
    },
    refresh,
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
