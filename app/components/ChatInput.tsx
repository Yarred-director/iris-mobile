import { getIrisTheme, type IrisThemeMode } from '@/constants/irisTheme';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PendingChatAttachment = {
  localId: string;
  uri: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  retention: 'temporary' | 'user_appearance';
};

export type ChatDraft = {
  text: string;
  attachments: PendingChatAttachment[];
};

type Props = {
  onSend: (draft: ChatDraft) => void | Promise<void>;
  disabled?: boolean;
  themeMode?: IrisThemeMode;
};

function normalizedMimeType(asset: ImagePicker.ImagePickerAsset) {
  const supplied = String(asset.mimeType || '').toLowerCase().split(';')[0];
  if (SUPPORTED_TYPES.has(supplied)) return supplied as PendingChatAttachment['mimeType'];
  const extension = String(asset.fileName || asset.uri || '').split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
}

export default function ChatInput({ onSend, disabled = false, themeMode = 'dark' }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingChatAttachment[]>([]);
  const theme = getIrisTheme(themeMode);
  const hasDraft = Boolean(text.trim() || attachments.length);

  const pickImages = useCallback(async () => {
    if (disabled || attachments.length >= MAX_ATTACHMENTS) return;
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Iris', 'Potrebujem prístup k fotogalérii.');
        return;
      }
    }
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      exif: false,
      base64: false,
    });
    if (result.canceled) return;
    const accepted: PendingChatAttachment[] = [];
    let rejected = false;
    result.assets.slice(0, remaining).forEach((asset, index) => {
      const mimeType = normalizedMimeType(asset);
      if (!mimeType || (asset.fileSize && asset.fileSize > MAX_ATTACHMENT_BYTES)) {
        rejected = true;
        return;
      }
      accepted.push({
        localId: asset.assetId || `${Date.now()}-${index}-${asset.uri}`,
        uri: asset.uri,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        mimeType,
        retention: 'temporary',
      });
    });
    if (rejected) Alert.alert('Iris', 'Podporujem JPG, PNG a WebP do 8 MB na obrázok.');
    setAttachments((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS));
  }, [attachments.length, disabled]);

  const submit = useCallback(() => {
    const clean = text.trim();
    if ((!clean && !attachments.length) || disabled) return;
    const draft = { text: clean, attachments };
    setText('');
    setAttachments([]);
    void onSend(draft);
  }, [attachments, disabled, onSend, text]);

  const toggleRetention = (localId: string) => {
    setAttachments((current) => current.map((attachment) => attachment.localId === localId
      ? { ...attachment, retention: attachment.retention === 'temporary' ? 'user_appearance' : 'temporary' }
      : attachment));
  };

  return (
    <View style={[styles.container, { borderColor: theme.inputBorder, backgroundColor: theme.inputBar }]}> 
      {!!attachments.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewRow}>
          {attachments.map((attachment) => {
            const permanent = attachment.retention === 'user_appearance';
            return (
              <View key={attachment.localId} style={[styles.previewCard, { backgroundColor: theme.surfaceSoft, borderColor: permanent ? theme.accent : theme.surfaceBorder }]}>
                <Image source={{ uri: attachment.uri }} style={styles.previewImage} contentFit="cover" />
                <Pressable accessibilityLabel="Odstrániť obrázok" onPress={() => setAttachments((current) => current.filter((item) => item.localId !== attachment.localId))} style={styles.removeButton}>
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: permanent }} onPress={() => toggleRetention(attachment.localId)} style={styles.retentionButton}>
                  <Text style={[styles.retentionText, { color: permanent ? theme.accent : theme.textMuted }]}>{permanent ? '✓ Môj vzhľad · trvalo' : '○ Zmizne o 30 dní'}</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.inputRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pridať obrázok"
          disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
          onPress={() => void pickImages()}
          style={[styles.attachButton, { backgroundColor: theme.inputBackground, borderColor: theme.surfaceBorder }, (disabled || attachments.length >= MAX_ATTACHMENTS) && styles.buttonDisabled]}
        >
          <Text style={[styles.attachText, { color: theme.text }]}>＋</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={attachments.length ? 'Napíš niečo k obrázku…' : 'Napíš Iris...'}
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
          disabled={disabled || !hasDraft}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.accent }, (disabled || !hasDraft) && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}
          onPress={submit}
        >
          <Text style={styles.buttonText}>{disabled ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, borderTopWidth: 1 },
  previewRow: { gap: 8, paddingBottom: 9 },
  previewCard: { width: 126, borderWidth: 1, borderRadius: 12, padding: 4 },
  previewImage: { width: 116, height: 78, borderRadius: 8 },
  removeButton: { position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)' },
  removeText: { color: '#fff', fontSize: 17, lineHeight: 19, fontWeight: '700' },
  retentionButton: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 3, paddingTop: 3 },
  retentionText: { fontSize: 10, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  attachButton: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  attachText: { fontSize: 24, lineHeight: 26 },
  input: { flex: 1, minHeight: 44, maxHeight: 132, fontSize: 16, lineHeight: 21, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginRight: 8, borderWidth: 1, outlineStyle: 'none' as any },
  button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
});
