import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_AVATAR_URL, UI_MANIFEST_URL } from '../../constants/ui';
import ChatInput from '../components/ChatInput';
import TypingIndicator from '../components/TypingIndicator';

const API_BASE = 'https://iris-mobile.onrender.com';
const API_CHAT = `${API_BASE}/chat`;

type Message = {
  role: 'user' | 'iris';
  text: string;
};

type BackgroundConfig = {
  image_url: string;
  overlay?: number;
  blur?: number;
};

type UIManifest = {
  chatBackground?: BackgroundConfig;
  avatar?: { image_url?: string };
  splash?: any; // nepotrebujeme tu, len kvôli kompatibilite manifestu
};

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<Message[]>([
    { role: 'iris', text: 'Ahoj. Som Iris.' },
  ]);

  const [bg, setBg] = useState<BackgroundConfig | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string>(DEFAULT_AVATAR_URL);
  const [isTyping, setIsTyping] = useState(false);

  /* ================= UI MANIFEST (Supabase) ================= */
  useEffect(() => {
    fetch(UI_MANIFEST_URL, { cache: 'no-store' })
      .then(res => res.json())
      .then((data: UIManifest) => {
        setBg(data?.chatBackground ?? null);

        const nextAvatar = data?.avatar?.image_url;
        if (typeof nextAvatar === 'string' && nextAvatar.length > 0) {
          setAvatarUrl(nextAvatar);
        } else {
          setAvatarUrl(DEFAULT_AVATAR_URL);
        }
      })
      .catch(() => {
        setBg(null);
        setAvatarUrl(DEFAULT_AVATAR_URL);
      });
  }, []);

  /* ================= SCROLL HELPERS ================= */
  const scrollToBottom = (animated = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  };

  // Scroll when new messages arrive or when typing indicator toggles
  useEffect(() => {
    scrollToBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isTyping]);

  /* ================= CHAT ================= */
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // ✅ schovaj klávesnicu po send
    Keyboard.dismiss();

    // pridaj user message
    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);

    // okamžitý scroll po user správe
    scrollToBottom(true);

    setIsTyping(true);

    try {
      const response = await fetch(API_CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'iris', text: data.reply }]);
      // scroll sa spraví v useEffect
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'iris', text: 'Nastala chyba pri spojení s Iris.' },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  /* ================= CONTENT ================= */
  const Screen = (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatar}
            contentFit="cover"
            transition={200}
            cachePolicy="disk"
          />
        </View>

        <View>
          <Text style={styles.headerName}>Iris</Text>
          <Text style={styles.headerStatus}>with you</Text>
        </View>
      </View>

      {/* MESSAGES */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollToBottom(false)}
      >
        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === 'user' ? styles.user : styles.iris,
            ]}
          >
            <Text style={styles.text}>{m.text}</Text>
          </View>
        ))}

        {/* ✅ fixná výška aby chat neskákal */}
        <View style={{ height: 26, marginLeft: 8, marginBottom: 8 }}>
          {isTyping && <TypingIndicator />}
        </View>
      </ScrollView>

      {/* INPUT */}
      <View style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
        <ChatInput onSend={sendMessage} />
      </View>
    </View>
  );

  /* ================= RENDER ================= */
  const Body = (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : insets.top}
    >
      {Screen}
    </KeyboardAvoidingView>
  );

  if (bg?.image_url) {
    return (
      <ImageBackground
        source={{ uri: bg.image_url }}
        style={styles.root}
        resizeMode="cover"
        blurRadius={bg.blur ?? 0}
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: `rgba(0,0,0,${bg.overlay ?? 0.35})` },
          ]}
        />
        <SafeAreaView style={{ flex: 1 }}>{Body}</SafeAreaView>
      </ImageBackground>
    );
  }

  return <SafeAreaView style={styles.root}>{Body}</SafeAreaView>;
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b0b0f',
  },
  container: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerStatus: {
    fontSize: 12,
    color: 'rgba(203,213,245,0.85)',
    marginTop: 2,
  },

  messages: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
  },

  // ✅ Minimalistické, užšie bubliny
  bubble: {
    maxWidth: '72%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    marginBottom: 8,
  },
  user: {
    backgroundColor: 'rgba(91,108,255,0.92)',
    alignSelf: 'flex-end',
    borderTopRightRadius: 8,
  },
  iris: {
    backgroundColor: 'rgba(31,31,42,0.72)',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 8,
  },
  text: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 18,
  },
});
