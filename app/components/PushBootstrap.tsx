import { useEffect, useRef } from "react";

import { useAuth } from "../../providers/AuthProvider";
import { registerForPushToken } from "../lib/push";
import { upsertPushTokenWithAccessToken } from "../lib/pushApi";

export default function PushBootstrap() {
  const { accessToken } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!accessToken) return;
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        console.log("[PUSH] bootstrap start");
        const token = await registerForPushToken();
        console.log("[PUSH] expo token =", token);

        if (!token) {
          console.log("[PUSH] token is null (device/permissions/projectId)");
          return;
        }

        const result = await upsertPushTokenWithAccessToken(accessToken, token);
        console.log("[PUSH] /push/register status =", result.status);
        console.log("[PUSH] /push/register body =", result.text.slice(0, 200));
      } catch (e: any) {
        console.log("[PUSH] bootstrap error =", e?.message ?? String(e));
      }
    })();
  }, [accessToken]);

  return null;
}