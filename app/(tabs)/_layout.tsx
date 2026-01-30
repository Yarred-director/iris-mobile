import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import LoadingScreen from '../loading';

const API_BASE = 'https://iris-mobile.onrender.com';

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
        const res = await fetch(`${API_BASE}/ui/splash`);
        const data = await res.json();

        if (data?.image_url) {
          setSplash(data);
        }
      } catch {
        setSplash(null);
      } finally {
        // UX delay – splash má čas sa ukázať
        setTimeout(() => setBooted(true), 300);
      }
    };

    boot();
  }, []);

  // 🔥 SPLASH FÁZA
  if (!booted && splash) {
    return <LoadingScreen config={splash} />;
  }

  // 🚀 APP
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="light" />
    </>
  );
}
