import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const REDIRECT_TO = "iris://auth/callback";
const STORAGE_KEY = "iris.supabase.auth";

export default function AuthScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const wipedRef = useRef(false);

  useEffect(() => {
    (async () => {
      if (wipedRef.current) return;
      wipedRef.current = true;

      await AsyncStorage.removeItem(STORAGE_KEY);
      await supabase.auth.signOut();

      console.log("AUTH: wiped storageKey + signed out", STORAGE_KEY);
    })();
  }, []);

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

    const before = await AsyncStorage.getItem(STORAGE_KEY);
    console.log("AUTH SEND: storage BEFORE =", before ? "HAS_VALUE" : "null");

    const { data, error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: REDIRECT_TO },
    });

    console.log("AUTH SEND: result", { error: error?.message, data });

    // nech sa stihne zapísať
    await new Promise((r) => setTimeout(r, 800));

    const after = await AsyncStorage.getItem(STORAGE_KEY);
    console.log("AUTH SEND: storage AFTER =", after ? "HAS_VALUE" : "null");

    if (error) {
      setErr(error.message);
      setStatus("error");
      sendingRef.current = false;
      return;
    }

    // 🔥 ak AFTER je null, PKCE flow state sa vôbec neukladá → exchange nikdy nemôže fungovať
    if (!after) {
      setErr("PKCE flow state sa neuložil (storage AFTER = null). Prepneme na password login (DEV).");
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
      <Text style={styles.sub}>Pošlem ti magic link na email. Nezavieraj appku. Klikni link hneď.</Text>

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
        <Text style={styles.btnText}>{status === "sending" ? "Sending..." : "Send magic link"}</Text>
      </Pressable>

      {status === "sent" && <Text style={styles.ok}>Hotovo. Pozri email a klikni link.</Text>}
      {!!err && <Text style={styles.err}>{err}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f", padding: 24, justifyContent: "center" },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  sub: { color: "rgba(255,255,255,0.75)", marginBottom: 18, lineHeight: 18 },
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
