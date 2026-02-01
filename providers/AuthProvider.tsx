import { supabase } from "@/lib/supabase";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

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
