// app/lib/pushApi.ts
import { API_URL } from "../../constants/api";
import { supabase } from "../../lib/supabase";

/**
 * New: deterministic register using a provided access token (most reliable in standalone).
 */
export async function upsertPushTokenWithAccessToken(
  accessToken: string,
  expoPushToken: string
) {
  const r = await fetch(`${API_URL}/push/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ expo_push_token: expoPushToken }),
  });

  const text = await r.text();
  return { status: r.status, text };
}

/**
 * Legacy: keeps old behavior, but may be flaky in standalone because session retrieval can race.
 */
export async function upsertPushToken(expoPushToken: string) {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.log("[PUSH] getSession error =", error.message);
      return;
    }

    const accessToken = data.session?.access_token;
    console.log("[PUSH] hasAccessToken =", !!accessToken);

    if (!accessToken) return;

    const { status, text } = await upsertPushTokenWithAccessToken(
      accessToken,
      expoPushToken
    );

    console.log("[PUSH] status =", status);
    console.log("[PUSH] body =", text.slice(0, 200));
  } catch (e) {
    console.log("[PUSH] fetch error =", String(e));
  }
}