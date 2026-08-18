import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function SetPasswordScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();
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
      setErrorMessage('Heslo musí mať aspoň 8 znakov.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Heslá sa nezhodujú.');
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
      setErrorMessage(error?.message || 'Heslo sa nepodarilo nastaviť.');
    } finally {
      submitRef.current = false;
      setWorking(false);
    }
  };

  if (loading || !user) {
    return (
      <View style={styles.root}>
        <Text style={styles.hint}>Kontrolujem účet…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Nastaviť heslo</Text>
        <Text style={styles.sub}>
          Nastavíš heslo priamo svojmu existujúcemu Iris účtu. User ID ani žiadne spomienky či história sa nemenia.
        </Text>

        {!done ? (
          <>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Nové heslo"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel="Nové heslo"
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Zopakuj heslo"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel="Zopakuj heslo"
              onSubmitEditing={() => void submit()}
            />
            <Pressable onPress={() => void submit()} style={styles.btn} disabled={working}>
              <Text style={styles.btnText}>{working ? 'Ukladám…' : 'Nastaviť heslo'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.ok}>Heslo je nastavené. Odteraz sa môžeš prihlasovať emailom a heslom.</Text>
            <Pressable onPress={() => router.replace('/(tabs)')} style={styles.btn}>
              <Text style={styles.btnText}>Späť do Iris</Text>
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
