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

 const sendMessage = async (text: string) => {
  if (!text.trim()) return;

  // pridaj user správu
  setMessages((prev) => [...prev, { role: 'user', text }]);

  try {
    const response = await fetch('http://localhost:3001/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: text }),
    });

    const data = await response.json();

    setMessages((prev) => [
      ...prev,
      { role: 'iris', text: data.reply },
    ]);
  } catch (error) {
    setMessages((prev) => [
      ...prev,
      { role: 'iris', text: 'Nastala chyba pri spojení s Iris.' },
    ]);
  }
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
