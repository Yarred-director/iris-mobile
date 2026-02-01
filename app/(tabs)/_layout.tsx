import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Linking } from "react-native";

// ✅ správne cesty z app/(tabs)/_layout.tsx
import { UI_MANIFEST_URL } from "../../constants/ui";
import { supabase } from "../../lib/supabase";
import { AuthProvider, useAuth } from "../../providers/AuthProvider";

SplashScreen.preventAutoHideAsync();

function Gate() {
  const router = useRouter();
  const segments = useSegments();
  const { user, loading } = useAuth();

  // ✅ Deep link -> spracuj magic link
  useEffect(() => {
    const handleUrl = async (url: string) => {
      try {
        // Supabase magic link na native príde ako: iris://auth/callback?code=...
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");

        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch {
        // ignore
      }
    };

    // initial url (keď app otvorí linkom)
    Linking.getInitialURL().then((u) => {
      if (u) handleUrl(u);
    });

    // runtime listener
    const sub = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => sub.remove();
  }, []);

  // ✅ Auth gate: bez user -> /auth, s user -> /(tabs)
  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === "auth";

    if (!user && !inAuth) {
      router.replace("/auth/index" as any);
      return;
    }

    if (user && inAuth) {
      router.replace("/(tabs)" as any);

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
        await fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" as any });
      } catch {
        // silent
      } finally {
        const minMs = 1200;
        const elapsed = Date.now() - started;
        const wait = Math.max(0, minMs - elapsed);

        setTimeout(async () => {
          if (!alive) return;
          setBooted(true);
          await SplashScreen.hideAsync();
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
      <Gate />
      <StatusBar style="light" />
    </AuthProvider>
  );
}
