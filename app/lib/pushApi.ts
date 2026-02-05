// app/lib/pushApi.ts
import { API_URL } from "../../constants/api";
import { supabase } from "../../lib/supabase";

export async function upsertPushToken(expoPushToken: string) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return;

  await fetch(`${API_URL}/push/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ expo_push_token: expoPushToken }),
  });
}