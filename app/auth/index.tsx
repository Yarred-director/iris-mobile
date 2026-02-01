import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const REDIRECT_TO = "iris://auth/callback";

export default function AuthScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const sendingRef = useRef(false);

  // ✅ auto-skip login keď už existuje session
  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(tabs)");
  }, [loading, user, router]);

  const send = async () => {
    if (sendingRef.current) return;

    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes("@")) {
      setErr("Zadaj platný email.");
      setStatus("error");
      return;
    }

    sendingRef.current = true;
    setErr(null);
    setStatus("sending");

    console.log("AUTH SEND: start", clean);

    const { data, error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: REDIRECT_TO },
    });

    console.log("AUTH SEND: result", { error: error?.message, data });

    if (error) {
      setErr(error.message);
      setStatus("error");
      sendingRef.current = false;
      return;
    }

    setStatus("sent");
    sendingRef.current = false;
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.sub}>
        Pošlem ti magic link na email. Nezavieraj appku. Klikni link hneď.
      </Text>

      {loading && (
        <Text style={styles.hint}>Kontrolujem session…</Text>
      )}

      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="email@domain.com"
        placeholderTextColor="rgba(255,255,255,0.35)"
        style={styles.input}
      />

      <Pressable onPress={send} style={styles.btn} disabled={status === "sending"}>
        <Text style={styles.btnText}>
          {status === "sending" ? "Sending..." : "Send magic link"}
        </Text>
      </Pressable>

      {status === "sent" && <Text style={styles.ok}>Hotovo. Pozri email a klikni link.</Text>}
      {!!err && <Text style={styles.err}>{err}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f", padding: 24, justifyContent: "center" },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  sub: { color: "rgba(255,255,255,0.75)", marginBottom: 14, lineHeight: 18 },

  hint: {
    color: "rgba(203,213,245,0.75)",
    marginBottom: 10,
    fontWeight: "600",
  },

  input: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    color: "#fff",
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  btn: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(91,108,255,0.9)",
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  ok: { marginTop: 14, color: "rgba(180,255,200,0.9)" },
  err: { marginTop: 14, color: "rgba(255,120,120,0.95)" },
});
