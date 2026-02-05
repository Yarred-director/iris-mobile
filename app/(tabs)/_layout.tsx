import { Stack } from "expo-router";
import { useEffect } from "react";

import { registerForPushToken } from "../lib/push";
import { upsertPushToken } from "../lib/pushApi";

export default function TabsLayout() {
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const token = await registerForPushToken();
        if (!alive || !token) return;

        await upsertPushToken(token);
      } catch (err) {
        console.warn("[PUSH_SETUP_FAILED]", err);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}