import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://iris-mobile.onrender.com";
const API_CHAT = `${API_BASE}/chat`;

const CHAT_STORAGE_KEY = "iris.chat.history.v1";
const MAX_MESSAGES = 50;

type Message = { role: "user" | "iris"; text: string };

type BackgroundConfig = { image_url: string; overlay?: number; blur?: number };
type UIManifest = { chatBackground?: BackgroundConfig; avatar?: { image_url?: string } };

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

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
        toValue: 1,
        duration: 10000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  useEffect(() => {
    if (!pulseKey || isUser) return;

    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
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
    : ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.04)"]) as readonly [
    ColorValue,
    ColorValue
  ];

  const sheenColors = [
    "rgba(255,255,255,0.0)",
    "rgba(255,255,255,0.16)",
    "rgba(255,255,255,0.0)",
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
        style={[
          styles.sheen,
          { opacity: sheenOpacity, transform: [{ translateX }, { translateY }, { rotate: "-12deg" }] },
        ]}
      />

      <Text style={styles.text}>{text}</Text>
    </LinearGradient>
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();

  const { loading, user, accessToken } = useAuth();

  // ✅ menu state
  const [menuOpen, setMenuOpen] = useState(false);

  // log len pri zmene
  useEffect(() => {
    console.log("AUTH:", { loading, userId: user?.id, hasToken: !!accessToken });
  }, [loading, user?.id, accessToken]);

  // auth guard
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
      const raw = await AsyncStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`)
      .then((res) => res.json())
      .then((data: UIManifest) => {
        setBg(data?.chatBackground ?? null);
        setAvatarUrl(data?.avatar?.image_url || DEFAULT_AVATAR_URL);
      })
      .catch(() => {
        setBg(null);
        setAvatarUrl(DEFAULT_AVATAR_URL);
      });
  }, []);

  const scrollToBottom = (animated = true) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  };

  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length, isTyping]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "iris") setIrisPulseKey((k) => k + 1);
  }, [messages]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMenuOpen(false);
    Keyboard.dismiss();

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setIsTyping(true);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await fetch(API_CHAT, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "iris", text: data.reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "iris", text: "Nastala chyba pri spojení s Iris." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const lastIrisIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "iris") return i;
    return -1;
  }, [messages]);

  const Screen = (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        </View>

        <View>
          <Text style={styles.headerName}>Iris</Text>
          <Text style={styles.headerStatus}>with you</Text>
        </View>

        {/* ⋯ MENU */}
        <View style={{ marginLeft: "auto" }}>
          <Pressable
            onPress={() => setMenuOpen((v) => !v)}
            style={styles.menuBtn}
            hitSlop={10}
          >
            <Text style={styles.menuDots}>⋯</Text>
          </Pressable>

          {menuOpen && (
            <View style={styles.menuPopover}>
              <Pressable
                onPress={async () => {
                  setMenuOpen(false);
                  await supabase.auth.signOut();
                  router.replace("/auth");
                }}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemText}>Odhlásiť sa</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {/* tap-away overlay, aby sa menu zavrelo klikom mimo */}
      {menuOpen && (
        <Pressable
          onPress={() => setMenuOpen(false)}
          style={styles.menuOverlay}
        />
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setMenuOpen(false)}
      >
        {messages.map((m, i) => (
          <GlassBubble
            key={`${i}-${m.role}`}
            role={m.role}
            text={m.text}
            pulseKey={i === lastIrisIndex && m.role === "iris" ? irisPulseKey : undefined}
          />
        ))}

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

  // ✅ Android keyboard: "height"
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
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: `rgba(0,0,0,${bg.overlay ?? 0.35})` },
            ]}
          />
          <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">
            {Body}
          </SafeAreaView>
        </ImageBackground>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} pointerEvents="box-none">
      {Body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f" },
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 5,
  },

  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
    marginRight: 12,
  },
  avatar: { width: "100%", height: "100%" },

  headerName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  headerStatus: { color: "rgba(203,213,245,0.85)", fontSize: 12 },

  messages: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },

  bubble: {
    maxWidth: "64%",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    marginBottom: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  userBubble: { alignSelf: "flex-end" },
  irisBubble: { alignSelf: "flex-start" },

  sheen: { position: "absolute", top: -12, left: -80, width: 200, height: 140 },
  text: { color: "#fff", fontSize: 14, lineHeight: 18 },

  // MENU
  menuBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  menuDots: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 22,
    lineHeight: 22,
    marginTop: -2,
  },
  menuPopover: {
    position: "absolute",
    top: 40,
    right: 0,
    minWidth: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(12,12,16,0.96)",
    overflow: "hidden",
    zIndex: 10,
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 14 },
  menuItemText: { color: "rgba(255,255,255,0.92)", fontWeight: "700" },

  menuOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 4, // pod header (zIndex 5), nad chat
  },
});
