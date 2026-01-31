import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { UI_MANIFEST_URL } from '../../constants/ui';
import LoadingScreen from '../loading';

type SplashConfig = {
  image_url: string;
  overlay?: number;
  blur?: number;
};

export default function RootLayout() {
  const [booted, setBooted] = useState(false);
  const [splash, setSplash] = useState<SplashConfig | null>(null);

  useEffect(() => {
    const boot = async () => {
      try {
        const res = await fetch(UI_MANIFEST_URL, { cache: 'no-store' });
        const data = await res.json();
        setSplash(data?.splash ?? null);
      } catch {
        setSplash(null);
      } finally {
        // malý UX delay, aby to nepôsobilo ako blik
        setTimeout(() => setBooted(true), 300);
      }
    };

    boot();
  }, []);

  // Remote splash fáza (vždy, aj s fallbackom)
  if (!booted) {
    return <LoadingScreen config={splash} />;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="light" />
    </>
  );
}
