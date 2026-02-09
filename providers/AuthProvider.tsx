import { API_URL } from "@/constants/api";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { registerForPushToken } from "../app/lib/push";

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
    if (error) console.warn("getSession error:", error.message);
    setSession(data.session ?? null);
  };

  // INIT SESSION
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) console.warn("getSession error:", error.message);
      setSession(data.session ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // REGISTER PUSH TOKEN AFTER LOGIN
  useEffect(() => {
    let cancelled = false;

    async function register() {
      try {
        if (!session?.access_token) return;

        const expoPushToken = await registerForPushToken();
        console.log("PUSH token obtained:", !!expoPushToken);

        if (!expoPushToken || cancelled) return;

        const res = await fetch(`${API_URL}/push/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            expo_push_token: expoPushToken,
            platform: Platform.OS,
            device_id: (Constants as any).deviceId ?? null,
          }),
        });

        const text = await res.text();
        console.log("PUSH register result:", res.status, text);
      } catch (err: any) {
        console.log("PUSH register error:", err?.message ?? String(err));
      }
    }

    register();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const value = useMemo<AuthCtx>(() => {
    return {
      user: session?.user ?? null,
      session,
      loading,
      accessToken: session?.access_token ?? null,
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refresh,
    };
  }, [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}