import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function ChatInput({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');

  return (
    <View style={styles.container}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Napíš Iris..."
        placeholderTextColor="#9ca3af"
        style={styles.input}
      />
      <Pressable
        style={styles.button}
        onPress={() => {
          if (!text.trim()) return;
          onSend(text);
          setText('');
        }}
      >
        <Text style={styles.buttonText}>Send</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1f',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  button: {
    backgroundColor: '#5b6cff',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
