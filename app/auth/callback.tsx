import { supabase } from "@/lib/supabase";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";

let lastExchangedCode: string | null = null;

export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    const code = params?.code;

    console.log("AUTH CALLBACK: params =", params);
    console.log("AUTH CALLBACK: code =", code);

    if (!code || typeof code !== "string") {
      console.log("AUTH CALLBACK: missing code -> /auth");
      router.replace("/auth");
      return;
    }

    // dev strict-mode: nedovoľ dvojité spustenie pre rovnaký code
    if (lastExchangedCode === code) {
      console.log("AUTH CALLBACK: already attempted, skipping");
      return;
    }
    lastExchangedCode = code;

    (async () => {
      try {
        console.log("AUTH CALLBACK: exchanging code =", code);

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        console.log("AUTH CALLBACK: exchange result =", {
          hasData: !!data,
          error: error?.message,
        });

        if (error) throw error;

        const { data: s } = await supabase.auth.getSession();
        console.log("AUTH CALLBACK: getSession after exchange =", {
          hasSession: !!s.session,
          userId: s.session?.user?.id,
        });

        router.replace("/(tabs)");
      } catch (e: any) {
        console.log("AUTH CALLBACK ERROR:", e?.message ?? e);
        lastExchangedCode = null;
        router.replace("/auth");
      }
    })();
  }, [params, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Signing you in…</Text>
    </View>
  );
}
