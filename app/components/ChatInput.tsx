import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Props = {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
};

export default function ChatInput({ onSend, disabled = false }: Props) {
  const [text, setText] = useState('');
  const submit = useCallback(() => {
    const clean = text.trim();
    if (!clean || disabled) return;
    setText('');
    void onSend(clean);
  }, [disabled, onSend, text]);

  return (
    <View style={styles.container}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Napíš Iris..."
        placeholderTextColor="#9ca3af"
        style={styles.input}
        multiline
        editable={!disabled}
        accessibilityLabel="Správa pre Iris"
        returnKeyType={Platform.OS === 'web' ? 'send' : 'default'}
        blurOnSubmit={false}
        onKeyPress={(event: any) => {
          if (Platform.OS !== 'web') return;
          const key = event?.nativeEvent?.key;
          const shiftKey = Boolean(event?.nativeEvent?.shiftKey);
          if (key === 'Enter' && !shiftKey) {
            event?.preventDefault?.();
            submit();
          }
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Odoslať správu"
        disabled={disabled || !text.trim()}
        style={({ pressed }) => [styles.button, (disabled || !text.trim()) && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}
        onPress={submit}
      >
        <Text style={styles.buttonText}>{disabled ? '…' : 'Send'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.35)' },
  input: { flex: 1, minHeight: 44, maxHeight: 132, backgroundColor: '#1a1a1f', color: '#ffffff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 8, outlineStyle: 'none' as any },
  button: { minHeight: 44, backgroundColor: '#5b6cff', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
});
