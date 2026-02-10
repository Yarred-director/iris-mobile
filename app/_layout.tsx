import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Linking } from "react-native";

import { UI_MANIFEST_URL } from "../constants/ui";
import { supabase } from "../lib/supabase";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

import PushBootstrap from "./components/PushBootstrap";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const router = useRouter();
  const segments = useSegments();
  const { user, loading } = useAuth();

  // ✅ Deep link handler (magic link)
  useEffect(() => {
    const handleUrl = async (url: string) => {
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        const path = parsed.pathname || "";

        // očakávame iris://auth/callback?code=...
        if (
          code &&
          (url.includes("iris://auth/callback") || path.includes("/callback"))
        ) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch {
        // ignore
      }
    };

    Linking.getInitialURL().then((u) => {
      if (u) handleUrl(u);
    });

    const sub = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => sub.remove();
  }, []);

  // ✅ Auth gate
  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === "auth";

    if (!user && !inAuth) {
      router.replace("/auth");
      return;
    }

    if (user && inAuth) {
      router.replace("/(tabs)");
      return;
    }
  }, [user, loading, segments, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      const started = Date.now();
      try {
        await fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`, {
          cache: "no-store" as any,
        }).catch(() => null);
      } finally {
        // krátky buffer proti flickeru
        const minMs = 350;
        const elapsed = Date.now() - started;
        const wait = Math.max(0, minMs - elapsed);

        setTimeout(() => {
          if (!alive) return;
          setBooted(true);
          SplashScreen.hideAsync().catch(() => {});
        }, wait);
      }
    };

    boot();
    return () => {
      alive = false;
    };
  }, []);

  if (!booted) return null;

  return (
    <AuthProvider>
      {/* 🔔 MUST run inside AuthProvider so it can read accessToken */}
      <PushBootstrap />

      <Gate />
      <StatusBar style="light" />
    </AuthProvider>
  );
}