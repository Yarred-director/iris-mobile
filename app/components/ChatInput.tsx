import { getIrisTheme, type IrisThemeMode } from '@/constants/irisTheme';
import { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useState } from 'react';

type Props = {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
  themeMode?: IrisThemeMode;
};

export default function ChatInput({ onSend, disabled = false, themeMode = 'dark' }: Props) {
  const [text, setText] = useState('');
  const theme = getIrisTheme(themeMode);
  const submit = useCallback(() => {
    const clean = text.trim();
    if (!clean || disabled) return;
    setText('');
    void onSend(clean);
  }, [disabled, onSend, text]);

  return (
    <View style={[styles.container, { borderColor: theme.inputBorder, backgroundColor: theme.inputBar }]}> 
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Napíš Iris..."
        placeholderTextColor={theme.placeholder}
        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.surfaceBorder }]}
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
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent }, (disabled || !text.trim()) && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}
        onPress={submit}
      >
        <Text style={styles.buttonText}>{disabled ? '…' : 'Send'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 44, maxHeight: 132, fontSize: 16, lineHeight: 21, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginRight: 8, borderWidth: 1, outlineStyle: 'none' as any },
  button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
});
