import { Stack } from "expo-router";
import { useEffect } from "react";

import { API_URL } from "../../constants/api";
import { registerForPushToken } from "../lib/push";
import { upsertPushToken } from "../lib/pushApi";

export default function TabsLayout() {
  useEffect(() => {
    let alive = true;

    // 🔍 DEBUG: PING BACKEND (dočasné)
    (async () => {
      try {
        console.log("[PING] API_URL =", API_URL);

        const r = await fetch(`${API_URL}/`, { method: "GET" });
        const t = await r.text();

        console.log("[PING] status =", r.status);
        console.log("[PING] body =", t.slice(0, 120));
      } catch (e) {
        console.log("[PING] fetch error =", String(e));
      }
    })();

    // 🔔 PUSH REGISTER FLOW
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