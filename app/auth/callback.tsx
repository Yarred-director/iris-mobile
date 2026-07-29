import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function AuthCallback() {
  const router = useRouter();
  const [message, setMessage] = useState('Signing you in…');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const search = typeof window !== 'undefined' ? window.location.search : '';
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const code = typeof window !== 'undefined' ? new URLSearchParams(search).get('code') : null;
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (hash.includes('access_token=')) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        } else {
          router.replace('/auth');
          return;
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error('No session after authentication callback');
        if (typeof window !== 'undefined') window.history.replaceState({}, document.title, '/auth/callback');
        router.replace('/(tabs)');
      } catch (error: any) {
        setMessage(error?.message || 'Login failed');
        setTimeout(() => router.replace('/auth'), 800);
      }
    })();
  }, [router]);

  return <View style={styles.root}><Text style={styles.text}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0f' },
  text: { color: '#fff' },
});
