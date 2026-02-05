// app/lib/pushApi.ts
import { API_URL } from "../../constants/api";
import { supabase } from "../../lib/supabase";

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

    const r = await fetch(`${API_URL}/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ expo_push_token: expoPushToken }),
    });

    const text = await r.text();
    console.log("[PUSH] status =", r.status);
    console.log("[PUSH] body =", text.slice(0, 200));
  } catch (e) {
    console.log("[PUSH] fetch error =", String(e));
  }
}