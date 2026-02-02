import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

export default function AuthCallback() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const href = typeof window !== "undefined" ? window.location.href : "";
        const search = typeof window !== "undefined" ? window.location.search : "";
        const hash = typeof window !== "undefined" ? window.location.hash : "";

        console.log("AUTH CALLBACK: href =", href);
        console.log("AUTH CALLBACK: search =", search);
        console.log("AUTH CALLBACK: hash =", hash);

        // 1) PKCE: ?code=...
        const code = typeof window !== "undefined"
          ? new URLSearchParams(search).get("code")
          : null;

        if (code) {
          console.log("AUTH CALLBACK: PKCE code found =", code);

          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;

          const { data: s1 } = await supabase.auth.getSession();
          console.log("AUTH CALLBACK: session after PKCE exchange =", {
            hasSession: !!s1.session,
            userId: s1.session?.user?.id,
          });

          if (!s1.session) throw new Error("No session after PKCE exchange");
          router.replace("/(tabs)");
          return;
        }

        // 2) Implicit: #access_token=...
        // Supabase can detect from URL if detectSessionInUrl=true, but with router/SSR race,
        // we force a short wait and then read session.
        if (hash && hash.includes("access_token=")) {
          console.log("AUTH CALLBACK: implicit token in hash, waiting for recover…");

          // give supabase a tick to recover session from URL
          await new Promise((r) => setTimeout(r, 250));

          const { data: s2 } = await supabase.auth.getSession();
          console.log("AUTH CALLBACK: session after implicit recover =", {
            hasSession: !!s2.session,
            userId: s2.session?.user?.id,
          });

          if (!s2.session) throw new Error("No session after implicit callback");

          // clean URL hash to avoid reruns / blank loops
          if (typeof window !== "undefined") {
            window.history.replaceState({}, document.title, "/auth/callback");
          }

          router.replace("/(tabs)");
          return;
        }

        // 3) Neither code nor token found -> go back to /auth
        console.log("AUTH CALLBACK: no code/token -> /auth");
        router.replace("/auth");
      } catch (e: any) {
        console.log("AUTH CALLBACK ERROR:", e?.message ?? e);
        setMsg(e?.message ?? "Login failed");
        // short delay so user sees it
        setTimeout(() => router.replace("/auth"), 400);
      }
    })();
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>{msg}</Text>
    </View>
  );
}
