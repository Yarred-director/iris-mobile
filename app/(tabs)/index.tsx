import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChatInput from '../components/ChatInput';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  'https://iris-mobile.onrender.com/chat';

type Message = {
  role: 'user' | 'iris';
  text: string;
};

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'iris', text: 'Ahoj. Som Iris.' },
  ]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json();

      setMessages((prev) => [...prev, { role: 'iris', text: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'iris', text: 'Nastala chyba pri spojení s Iris.' },
      ]);
    }
  };

  return (
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
            <Image
              source={require('../../assets/images/iris/face-default.png')}
              style={styles.avatar}
            />
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
          keyboardShouldPersistTaps="handled"
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
);

}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
    backgroundColor: '#0b0b0b',
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
    color: '#9ca3af',
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
    backgroundColor: '#1f1f2a',
    alignSelf: 'flex-start',
  },
  text: {
    color: '#ffffff',
  },
});
