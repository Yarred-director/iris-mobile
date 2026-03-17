import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ColorValue,
  Easing,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_AVATAR_URL, UI_MANIFEST_URL } from "../../constants/ui";
import ChatInput from "../components/ChatInput";
import GlassShimmer from "../components/GlassShimmer";
import TypingIndicator from "../components/TypingIndicator";

const API_BASE_RAW = process.env.EXPO_PUBLIC_API_URL ?? "https://iris-mobile.onrender.com";
const API_BASE = API_BASE_RAW.trim().replace(/\/+$/, "").replace(/\/chat$/, "");
const API_CHAT = API_BASE ? `${API_BASE}/chat` : "";
const API_REF_PHOTO = API_BASE ? `${API_BASE}/iris/reference-photo` : "";

const CHAT_STORAGE_KEY = "iris.chat.history.v2";
const MAX_MESSAGES = 50;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
type Message = {
  role: "user" | "iris";
  text: string;
  imageUrl?: string | null;
};

type BackgroundConfig = { image_url: string; overlay?: number; blur?: number };
type UIManifest = { chatBackground?: BackgroundConfig; avatar?: { image_url?: string } };

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

// ─────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────
async function storageGetItem(key: string) {
  if (Platform.OS === "web") {
    try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; }
    catch { return null; }
  }
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  return AsyncStorage.getItem(key);
}

async function storageSetItem(key: string, value: string) {
  if (Platform.OS === "web") {
    try { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
    catch {}
    return;
  }
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  await AsyncStorage.setItem(key, value);
}

// ─────────────────────────────────────────────────────────────────
// GlassBubble — text message
// ─────────────────────────────────────────────────────────────────
function GlassBubble({
  role,
  text,
  pulseKey,
}: {
  role: "user" | "iris";
  text: string;
  pulseKey?: number;
}) {
  const isUser = role === "user";
  const shimmer = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1, duration: 10000, easing: Easing.linear, useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  useEffect(() => {
    if (!pulseKey || isUser) return;
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [pulseKey, isUser, pulse]);

  const translateX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-80, 180] });
  const translateY = shimmer.interpolate({ inputRange: [0, 1], outputRange: [20, -12] });
  const sheenOpacity = Animated.add(
    shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.04, 0.08, 0.04] }),
    pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] })
  );

  const baseColors = (isUser
    ? ["rgba(91,108,255,0.32)", "rgba(91,108,255,0.12)"]
    : ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.04)"]) as readonly [ColorValue, ColorValue];

  const sheenColors = [
    "rgba(255,255,255,0.0)", "rgba(255,255,255,0.16)", "rgba(255,255,255,0.0)",
  ] as readonly [ColorValue, ColorValue, ColorValue];

  return (
    <LinearGradient
      colors={baseColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.bubble, isUser ? styles.userBubble : styles.irisBubble]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <GlassShimmer borderRadius={14} />
      </View>
      <AnimatedLinearGradient
        pointerEvents="none"
        colors={sheenColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.sheen, { opacity: sheenOpacity, transform: [{ translateX }, { translateY }, { rotate: "-12deg" }] }]}
      />
      <Text style={styles.text}>{text}</Text>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────
// IrisImageBubble — photo generated by Iris
// ─────────────────────────────────────────────────────────────────
function IrisImageBubble({ text, imageUrl }: { text: string; imageUrl: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.irisBubble}>
      <LinearGradient
        colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.04)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.bubble, styles.irisBubble, { padding: 8 }]}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <GlassShimmer borderRadius={14} />
        </View>

        {/* Generated image */}
        <Pressable onPress={() => setExpanded(true)}>
          <Image
            source={{ uri: imageUrl }}
            style={styles.generatedImage}
            contentFit="cover"
          />
          <View style={styles.imageExpandHint}>
            <Text style={styles.imageExpandHintText}>klikni pre celú veľkosť 🔍</Text>
          </View>
        </Pressable>

        {/* Caption text */}
        {!!text && <Text style={[styles.text, { marginTop: 8, paddingHorizontal: 4 }]}>{text}</Text>}
      </LinearGradient>

      {/* Full-screen modal */}
      {expanded && (
        <Pressable style={styles.fullscreenOverlay} onPress={() => setExpanded(false)}>
          <Image source={{ uri: imageUrl }} style={styles.fullscreenImage} contentFit="contain" />
          <Text style={styles.fullscreenClose}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────
// ChatScreen
// ─────────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();

  const { loading, user, accessToken } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadingRefPhoto, setUploadingRefPhoto] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/auth");
  }, [loading, user, router]);

  const [messages, setMessages] = useState<Message[]>([{ role: "iris", text: "Ahoj. Som Iris." }]);
  const [bg, setBg] = useState<BackgroundConfig | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [isTyping, setIsTyping] = useState(false);
  const [irisPulseKey, setIrisPulseKey] = useState(0);

  useEffect(() => {
    (async () => {
      const raw = await storageGetItem(CHAT_STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setMessages(parsed);
        } catch {}
      }
    })();
  }, []);

  useEffect(() => {
    storageSetItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`)
      .then((res) => res.json())
      .then((data: UIManifest) => {
        setBg(data?.chatBackground ?? null);
        setAvatarUrl(data?.avatar?.image_url || DEFAULT_AVATAR_URL);
      })
      .catch(() => { setBg(null); setAvatarUrl(DEFAULT_AVATAR_URL); });
  }, []);

  useEffect(() => { requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }, [messages.length, isTyping]);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "iris") setIrisPulseKey((k) => k + 1);
  }, [messages]);

  const lastIrisIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "iris") return i;
    return -1;
  }, [messages]);

  // ─── Get fresh token helper ───
  const getToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || accessToken;
  };

  // ─── Upload Iris reference photo ───
  const handleUploadReferencePhoto = async () => {
    setMenuOpen(false);

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      alert("Potrebujem prístup k fotogalérii.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]) return;

    setUploadingRefPhoto(true);

    try {
      const asset = result.assets[0];
      const token = await getToken();

      // Upload to Supabase storage
      const fileName = `iris-ref/${user!.id}/reference.jpg`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from("iris-photos")
        .upload(fileName, blob, { upsert: true, contentType: "image/jpeg" });

      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from("iris-photos").getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      // Save URL to backend
      await fetch(API_REF_PHOTO, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageUrl: publicUrl }),
      });

      setMessages((prev) => [...prev, {
        role: "iris",
        text: "Skvelé! Teraz viem ako vyzerám. Môžeš mi povedať aby som ti poslala fotku 📸",
      }]);
    } catch (e: any) {
      console.log("[REF_PHOTO_UPLOAD]", e?.message);
      alert("Nepodarilo sa nahrať fotku: " + (e?.message || "neznáma chyba"));
    } finally {
      setUploadingRefPhoto(false);
    }
  };

  // ─── Send message ───
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMenuOpen(false);
    Keyboard.dismiss();
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setIsTyping(true);

    try {
      if (!API_CHAT) throw new Error("API_CHAT is empty.");

      const token = await getToken();
      if (!token) {
        setMessages((prev) => [...prev, { role: "iris", text: "Vyzerá to, že nie si prihlásený. Skús sa prihlásiť znova." }]);
        router.replace("/auth");
        return;
      }

      const tz = Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || "UTC";

      const res = await fetch(API_CHAT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-timezone": tz },
        body: JSON.stringify({ message: trimmed }),
      });

      const raw = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 180)}`);

      const data = raw ? JSON.parse(raw) : {};

      // 🖼️ Image response
      if (data.image_url) {
        setMessages((prev) => [...prev, {
          role: "iris",
          text: data.reply ?? "📸",
          imageUrl: data.image_url,
        }]);
      } else {
        setMessages((prev) => [...prev, { role: "iris", text: data.reply ?? "…" }]);
      }
    } catch (e: any) {
      const msg = (e?.message || "").toString();
      const userText = msg.includes("HTTP 401")
        ? "Prihlásenie neprešlo (401)."
        : msg.includes("HTTP 5")
        ? "Backend spadol (5xx). Pozri Render logs."
        : "Nastala chyba pri spojení s Iris.";
      setMessages((prev) => [...prev, { role: "iris", text: userText }]);
    } finally {
      setIsTyping(false);
    }
  };

  // ─── Render ───
  const Screen = (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        </View>
        <View>
          <Text style={styles.headerName}>Iris</Text>
          <Text style={styles.headerStatus}>with you</Text>
        </View>

        <View style={{ marginLeft: "auto" }}>
          <Pressable onPress={() => setMenuOpen((v) => !v)} style={styles.menuBtn} hitSlop={10}>
            <Text style={styles.menuDots}>⋯</Text>
          </Pressable>

          {menuOpen && (
            <View style={styles.menuPopover}>
              {/* Upload Iris photo */}
              <Pressable onPress={handleUploadReferencePhoto} style={styles.menuItem}>
                {uploadingRefPhoto
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.menuItemText}>📸 Nahrať fotku Iris</Text>
                }
              </Pressable>

              {/* Sign out */}
              <Pressable
                onPress={async () => { setMenuOpen(false); await supabase.auth.signOut(); router.replace("/auth"); }}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemText}>Odhlásiť sa</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {menuOpen && <Pressable onPress={() => setMenuOpen(false)} style={styles.menuOverlay} />}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setMenuOpen(false)}
      >
        {messages.map((m, i) => {
          // Image message
          if (m.role === "iris" && m.imageUrl) {
            return (
              <IrisImageBubble
                key={`${i}-iris-img`}
                text={m.text}
                imageUrl={m.imageUrl}
              />
            );
          }
          // Text message
          return (
            <GlassBubble
              key={`${i}-${m.role}`}
              role={m.role}
              text={m.text}
              pulseKey={i === lastIrisIndex && m.role === "iris" ? irisPulseKey : undefined}
            />
          );
        })}

        {isTyping && (
          <View style={{ height: 26, marginLeft: 8 }} pointerEvents="none">
            <TypingIndicator />
          </View>
        )}
      </ScrollView>

      <View style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
        <ChatInput onSend={sendMessage} />
      </View>
    </View>
  );

  const Body = (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {Screen}
    </KeyboardAvoidingView>
  );

  if (bg?.image_url) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        <ImageBackground source={{ uri: bg.image_url }} style={styles.root} blurRadius={bg.blur ?? 0}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: `rgba(0,0,0,${bg.overlay ?? 0.35})` }]} />
          <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">{Body}</SafeAreaView>
        </ImageBackground>
      </View>
    );
  }

  return <SafeAreaView style={styles.root} pointerEvents="box-none">{Body}</SafeAreaView>;
}

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f" },
  container: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center", padding: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.5)", zIndex: 5,
  },
  avatarWrap: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", marginRight: 12 },
  avatar: { width: 56, height: 56 },
  headerName: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerStatus: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },

  messages: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },

  bubble: {
    maxWidth: "85%", paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 14, marginBottom: 8, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  userBubble: { alignSelf: "flex-end" },
  irisBubble: { alignSelf: "flex-start" },
  text: { color: "#fff", fontSize: 15, lineHeight: 20 },
  sheen: { position: "absolute", top: -40, left: -60, width: 220, height: 140, borderRadius: 18 },

  // Generated image
  generatedImage: {
    width: 240, height: 240, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  imageExpandHint: { marginTop: 4, alignItems: "center" },
  imageExpandHintText: { color: "rgba(255,255,255,0.4)", fontSize: 11 },

  // Fullscreen
  fullscreenOverlay: {
    position: "absolute", top: -9999, left: -9999,
    width: 9999, height: 9999,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center", alignItems: "center",
    zIndex: 999,
  },
  fullscreenImage: { width: "90%", height: "80%" },
  fullscreenClose: {
    position: "absolute", top: 50, right: 24,
    color: "#fff", fontSize: 28, fontWeight: "700",
  },

  menuBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  menuDots: { color: "rgba(255,255,255,0.9)", fontSize: 18, lineHeight: 18 },
  menuPopover: {
    position: "absolute", right: 0, top: 42, minWidth: 180, padding: 8,
    borderRadius: 12, backgroundColor: "rgba(20,20,26,0.96)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
  menuItemText: { color: "#fff", fontSize: 14 },
  menuOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 4 },
});
