import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import ChatInput from '../components/ChatInput';

type Message = {
  role: 'user' | 'iris';
  text: string;
};

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'iris', text: 'Ahoj. Som Iris.' },
  ]);

  const sendMessage = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', text }]);

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: 'iris', text: `Počujem ťa: "${text}"` },
      ]);
    }, 600);
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.messages}>
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

      <ChatInput onSend={sendMessage} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
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
    color: '#fff',
  },
});
