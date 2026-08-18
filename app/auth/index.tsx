import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Mode = 'login' | 'register';
type Status = 'idle' | 'working' | 'sent' | 'confirm' | 'error';

export default function AuthScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
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

  const resetFeedback = () => {
    setStatus('idle');
    setErrorMessage(null);
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setConfirmPassword('');
    resetFeedback();
  };

  const submitPassword = async () => {
    if (sendingRef.current) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Zadaj platný email.');
      setStatus('error');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Heslo musí mať aspoň 8 znakov.');
      setStatus('error');
      return;
    }
    if (mode === 'register' && cleanName.length < 2) {
      setErrorMessage('Zadaj svoje meno.');
      setStatus('error');
      return;
    }
    if (mode === 'register' && password !== confirmPassword) {
      setErrorMessage('Heslá sa nezhodujú.');
      setStatus('error');
      return;
    }

    sendingRef.current = true;
    setErrorMessage(null);
    setStatus('working');

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        router.replace('/(tabs)');
        return;
      }

      const redirectTo = getRedirectTo();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            display_name: cleanName,
            name: cleanName,
          },
          ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
        },
      });
      if (error) throw error;

      if (data.session) {
        router.replace('/(tabs)');
      } else {
        setStatus('confirm');
      }
    } catch (error: any) {
      setErrorMessage(error?.message || (mode === 'login' ? 'Prihlásenie sa nepodarilo.' : 'Registrácia sa nepodarila.'));
      setStatus('error');
    } finally {
      sendingRef.current = false;
    }
  };

  // Backward-compatible fallback for accounts created before password login existed.
  const sendMagicLink = async () => {
    if (sendingRef.current) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Najprv zadaj svoj email.');
      setStatus('error');
      return;
    }

    sendingRef.current = true;
    setErrorMessage(null);
    setStatus('working');
    try {
      const redirectTo = getRedirectTo();
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: redirectTo ? { emailRedirectTo: redirectTo, shouldCreateUser: false } : { shouldCreateUser: false },
      });
      if (error) throw error;
      setStatus('sent');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Odoslanie odkazu sa nepodarilo.');
      setStatus('error');
    } finally {
      sendingRef.current = false;
    }
  };

  const working = status === 'working';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Iris</Text>
      <Text style={styles.sub}>{mode === 'login' ? 'Prihlás sa do svojho účtu.' : 'Vytvor si účet pre Iris.'}</Text>

      <View style={styles.tabs}>
        <Pressable onPress={() => switchMode('login')} style={[styles.tab, mode === 'login' && styles.tabActive]}>
          <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Login</Text>
        </Pressable>
        <Pressable onPress={() => switchMode('register')} style={[styles.tab, mode === 'register' && styles.tabActive]}>
          <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>Register</Text>
        </Pressable>
      </View>

      {loading && <Text style={styles.hint}>Kontrolujem session…</Text>}

      {mode === 'register' && (
        <TextInput
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Meno"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          accessibilityLabel="Meno"
          textContentType="name"
        />
      )}

      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="email@domain.com"
        placeholderTextColor="rgba(255,255,255,0.35)"
        style={styles.input}
        accessibilityLabel="Email"
        textContentType="emailAddress"
        autoComplete="email"
      />

      <TextInput
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="Heslo"
        placeholderTextColor="rgba(255,255,255,0.35)"
        style={styles.input}
        accessibilityLabel="Heslo"
        textContentType={mode === 'register' ? 'newPassword' : 'password'}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        onSubmitEditing={() => mode === 'login' && void submitPassword()}
      />

      {mode === 'register' && (
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="Zopakuj heslo"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          accessibilityLabel="Zopakuj heslo"
          textContentType="newPassword"
          autoComplete="new-password"
          onSubmitEditing={() => void submitPassword()}
        />
      )}

      <Pressable onPress={() => void submitPassword()} style={styles.btn} disabled={working}>
        <Text style={styles.btnText}>{working ? 'Pracujem…' : mode === 'login' ? 'Prihlásiť sa' : 'Vytvoriť účet'}</Text>
      </Pressable>

      {mode === 'login' && (
        <Pressable onPress={() => void sendMagicLink()} disabled={working} style={styles.linkBtn}>
          <Text style={styles.linkText}>Nemáš ešte heslo? Pošli mi starý magic link</Text>
        </Pressable>
      )}

      {status === 'sent' && <Text style={styles.ok}>Magic link je odoslaný. Toto je len prechodný fallback pre starší účet.</Text>}
      {status === 'confirm' && <Text style={styles.ok}>Účet je vytvorený. Ak má projekt zapnuté potvrdenie emailu, dokonči jednorazové overenie z emailu.</Text>}
      {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f', padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 31, fontWeight: '800', marginBottom: 6 },
  sub: { color: 'rgba(255,255,255,0.72)', marginBottom: 18, lineHeight: 19 },
  tabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 4, marginBottom: 16 },
  tab: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: 'rgba(91,108,255,0.95)' },
  tabText: { color: 'rgba(255,255,255,0.62)', fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  hint: { color: 'rgba(203,213,245,0.75)', marginBottom: 10, fontWeight: '600' },
  input: { height: 50, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', color: '#fff', marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  btn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(91,108,255,0.9)', marginTop: 2 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 8 },
  linkText: { color: 'rgba(190,199,255,0.9)', fontWeight: '600', textAlign: 'center' },
  ok: { marginTop: 14, color: 'rgba(180,255,200,0.9)', lineHeight: 19 },
  error: { marginTop: 14, color: 'rgba(255,120,120,0.95)', lineHeight: 19 },
});
