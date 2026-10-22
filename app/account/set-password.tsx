import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function SetPasswordScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submitRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/auth');
  }, [loading, user, router]);

  const submit = async () => {
    if (submitRef.current || !user) return;
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage(t('auth.password_too_short'));
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage(t('auth.password_mismatch'));
      return;
    }

    submitRef.current = true;
    setWorking(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmPassword('');
      setDone(true);
    } catch (error: any) {
      setErrorMessage(error?.message || t('password.failed'));
    } finally {
      submitRef.current = false;
      setWorking(false);
    }
  };

  if (loading || !user) {
    return (
      <View style={styles.root}>
        <Text style={styles.hint}>{t('auth.checking_session')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('password.title')}</Text>
        <Text style={styles.sub}>{t('password.subtitle')}</Text>

        {!done ? (
          <>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('password.new')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel={t('password.new')}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('auth.password_repeat')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel={t('auth.password_repeat')}
              onSubmitEditing={() => void submit()}
            />
            <Pressable onPress={() => void submit()} style={styles.btn} disabled={working}>
              <Text style={styles.btnText}>{working ? t('common.saving') : t('password.set')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.ok}>{t('password.done')}</Text>
            <Pressable onPress={() => router.replace('/(tabs)')} style={styles.btn}>
              <Text style={styles.btnText}>{t('password.back', { name: 'Iris' })}</Text>
            </Pressable>
          </>
        )}

        {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f', padding: 24, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 460 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', marginBottom: 8 },
  sub: { color: 'rgba(255,255,255,0.72)', lineHeight: 20, marginBottom: 18 },
  hint: { color: 'rgba(203,213,245,0.75)', fontWeight: '600' },
  input: { height: 50, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', color: '#fff', marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  btn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(91,108,255,0.9)', marginTop: 2 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ok: { color: 'rgba(180,255,200,0.9)', lineHeight: 20, marginBottom: 14 },
  error: { marginTop: 14, color: 'rgba(255,120,120,0.95)', lineHeight: 19 },
});
