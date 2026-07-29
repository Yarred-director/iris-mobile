import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function AuthScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/(tabs)');
  }, [loading, user, router]);

  const getRedirectTo = () => {
    if (Platform.OS !== 'web') return 'iris://auth/callback';
    if (typeof window !== 'undefined') return `${window.location.origin}/auth/callback`;
    return undefined;
  };

  const send = async () => {
    if (sendingRef.current) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Zadaj platný email.');
      setStatus('error');
      return;
    }
    sendingRef.current = true;
    setErrorMessage(null);
    setStatus('sending');
    try {
      const redirectTo = getRedirectTo();
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (error) throw error;
      setStatus('sent');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Prihlásenie sa nepodarilo.');
      setStatus('error');
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.sub}>Pošlem ti magic link na email. Klikni naň v tomto zariadení.</Text>
      {loading && <Text style={styles.hint}>Kontrolujem session…</Text>}
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="email@domain.com" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} accessibilityLabel="Email" onSubmitEditing={() => void send()} />
      <Pressable onPress={() => void send()} style={styles.btn} disabled={status === 'sending'}>
        <Text style={styles.btnText}>{status === 'sending' ? 'Sending…' : 'Send magic link'}</Text>
      </Pressable>
      {status === 'sent' && <Text style={styles.ok}>Hotovo. Pozri email a klikni na odkaz.</Text>}
      {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f', padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  sub: { color: 'rgba(255,255,255,0.75)', marginBottom: 14, lineHeight: 18 },
  hint: { color: 'rgba(203,213,245,0.75)', marginBottom: 10, fontWeight: '600' },
  input: { height: 50, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', color: '#fff', marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  btn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(91,108,255,0.9)' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ok: { marginTop: 14, color: 'rgba(180,255,200,0.9)' },
  error: { marginTop: 14, color: 'rgba(255,120,120,0.95)' },
});
