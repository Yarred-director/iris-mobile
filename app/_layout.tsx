import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { UI_MANIFEST_URL } from '../constants/ui';
import { AuthProvider } from '../providers/AuthProvider';

type SplashConfig = {
  image_url: string;
  overlay?: number;
  blur?: number;
};

type UIManifest = {
  splash?: SplashConfig;
};

// ✅ drž native splash (tvoja fotka z app.json) kým nepovieš hide
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      const started = Date.now();

      try {
        // nech si stále načítaš ui manifest (cache-bust)
        await fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
      } catch {
        // silent
      } finally {
        // ✅ ak chceš “min 2s”, necháme to, ale bez medziscreenu
        const minMs = 2000;
        const elapsed = Date.now() - started;
        const wait = Math.max(0, minMs - elapsed);

        setTimeout(async () => {
          if (!alive) return;
          setBooted(true);
          await SplashScreen.hideAsync(); // ✅ až teraz pustíme appku
        }, wait);
      }
    };

    boot();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ kým bootuješ, nerenderuj nič -> native splash ostane -> žiadne prebliknutie
  if (!booted) return null;

  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
      <StatusBar style="light" />
    </AuthProvider>
  );
}
