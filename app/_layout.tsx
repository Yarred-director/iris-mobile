import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { UI_MANIFEST_URL } from '../constants/ui';
import LoadingScreen from './loading';

type SplashConfig = {
  image_url: string;
  overlay?: number;
  blur?: number;
};

type UIManifest = {
  splash?: SplashConfig;
};

export default function RootLayout() {
  const [booted, setBooted] = useState(false);
  const [splash, setSplash] = useState<SplashConfig | null>(null);

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      const started = Date.now();

      try {
        // cache-bust nech necita starý ui.json
        const res = await fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as UIManifest;

        if (alive) setSplash(data?.splash ?? null);
      } catch {
        if (alive) setSplash(null);
      } finally {
        // ✅ nech to user naozaj VIDÍ (2s)
        const minMs = 2000;
        const elapsed = Date.now() - started;
        const wait = Math.max(0, minMs - elapsed);

        setTimeout(() => {
          if (alive) setBooted(true);
        }, wait);
      }
    };

    boot();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ Splash fáza vždy (aj keď remote config padne -> LoadingScreen fallback)
  if (!booted) {
    return <LoadingScreen config={splash} />;
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
      <StatusBar style="light" />
    </>
  );
}
