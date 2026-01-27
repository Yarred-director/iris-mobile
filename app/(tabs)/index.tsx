import { useEffect, useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChatInput from '../components/ChatInput';

const API_BASE = 'https://iris-mobile.onrender.com';
const API_CHAT = `${API_BASE}/chat`;

// AVATAR
const IRIS_AVATAR_URL =
  'https://glufbaseqhjkljhvdhmh.supabase.co/storage/v1/object/public/avatars/iris-avatar-v1.png';

type Message = {
  role: 'user' | 'iris';
  text: string;
};

type BackgroundConfig = {
  image_url: string;
  overlay?: {
    max: number;
  };
  blur?: number;
};

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'iris', text: 'Ahoj. Som Iris.' },
  ]);

  const [bg, setBg] = useState<BackgroundConfig | null>(null);

  /* ================= BACKGROUND ================= */
  useEffect(() => {
    fetch(`${API_BASE}/ui/chat-background`)
      .then(res => res.json())
      .then(setBg)
      .catch(() => setBg(null));
  }, []);

  /* ================= CHAT ================= */
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    setMessages(prev => [...prev, { role: 'user', text }]);

    try {
      const response = await fetch(API_CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'iris', text: data.reply }]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'iris', text: 'Nastala chyba pri spojení s Iris.' },
      ]);
    }
  };

  /* ================= CONTENT ================= */
  const Content = (
    <>
      {/* OVERLAY */}
      {bg?.image_url && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: `rgba(0,0,0,${bg.overlay?.max ?? 0.35})`,
            },
          ]}
        />
      )}

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
          keyboardVerticalOffset={96}
        >
          <View style={styles.container}>
            {/* HEADER */}
            <View style={styles.header}>
              <View style={styles.avatarWrap}>
                <Image source={{ uri: IRIS_AVATAR_URL }} style={styles.avatar} />
              </View>

              <View>
                <Text style={styles.headerName}>Iris</Text>
                <Text style={styles.headerStatus}>with you</Text>
              </View>
            </View>

            {/* MESSAGES */}
            <ScrollView
              style={styles.messages}
              contentContainerStyle={{ paddingBottom: 140 }}
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
            </ScrollView>

            {/* INPUT */}
            <ChatInput onSend={sendMessage} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );

  /* ================= RENDER ================= */
  if (bg?.image_url) {
    return (
      <ImageBackground
        source={{ uri: bg.image_url }}
        style={styles.root}
        resizeMode="cover"
        blurRadius={bg.blur ?? 0}
      >
        {Content}
      </ImageBackground>
    );
  }

  return <View style={styles.root}>{Content}</View>;
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
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  headerName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerStatus: {
    fontSize: 12,
    color: '#cbd5f5',
    marginTop: 2,
  },
  messages: {
    flex: 1,
    padding: 12,
  },
  bubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  user: {
    backgroundColor: '#5b6cff',
    alignSelf: 'flex-end',
  },
  iris: {
    backgroundColor: 'rgba(31,31,42,0.85)',
    alignSelf: 'flex-start',
  },
  text: {
    color: '#ffffff',
  },
});
