import { getIrisTheme, IRIS_THEME_STORAGE_KEY, type IrisThemeMode } from '@/constants/irisTheme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ImageBackground, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_AVATAR_URL, UI_MANIFEST_URL } from '../../constants/ui';
import ChatInput from '../components/ChatInput';
import GlassShimmer from '../components/GlassShimmer';
import RichText from '../components/RichText';
import TypingIndicator from '../components/TypingIndicator';
import { enableWebPush, getWebPushStatus, listenForWebPushReply, type WebPushStatus } from '../lib/webPush';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://iris-mobile.onrender.com').trim().replace(/\/+$/, '').replace(/\/chat$/, '');
const API_CHAT = `${API_BASE}/chat`;
const API_HISTORY = `${API_BASE}/chat/history`;
const API_MEDIA_SIGN = `${API_BASE}/media/sign`;
const API_REF_PHOTO = `${API_BASE}/iris/reference-photo`;
const IRIS_AVATAR_BUCKET = 'iris-photos';
const MAX_MESSAGES = 50;
const REQUEST_TIMEOUT_MS = 300000;

type Message = { id?: string; role: 'user' | 'iris'; text: string; imageUrl?: string | null; imageBucket?: string | null; imagePath?: string | null; createdAt?: string | null; clientMessageId?: string | null };
type BackgroundConfig = { image_url: string; overlay?: number; blur?: number };
type UIManifest = { chatBackground?: BackgroundConfig; avatar?: { image_url?: string } };
type ServerMessage = { id: string; role: 'user' | 'assistant'; content: string; image_url?: string | null; image_bucket?: string | null; image_path?: string | null; created_at?: string | null; client_message_id?: string | null };

function storageKey(userId: string) { return `iris.chat.history.v3:${userId}`; }
function irisAvatarPath(userId: string) { return `ui-avatar/${userId}/avatar`; }
async function storageGet(key: string) {
  if (Platform.OS === 'web') { try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; } }
  return (await import('@react-native-async-storage/async-storage')).default.getItem(key);
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') { try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch {} return; }
  await (await import('@react-native-async-storage/async-storage')).default.setItem(key, value);
}
function initialThemeMode(): IrisThemeMode {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'dark';
  try { return window.localStorage.getItem(IRIS_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
async function fetchTimed(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function parseStoredLocation(imageUrl: string | null | undefined, userId: string) {
  if (!imageUrl) return null;
  try {
    const match = new URL(imageUrl).pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    const parts = path.split('/');
    if (bucket !== 'iris-photos' || parts[1] !== userId || !['generated', 'iris-ref'].includes(parts[0])) return null;
    return { bucket, path };
  } catch { return null; }
}
function localMessages(value: unknown, userId: string): Message[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_MESSAGES).flatMap((item: any) => {
    if (!item || !['user', 'iris'].includes(item.role)) return [];
    const location = parseStoredLocation(item.imageUrl, userId);
    return [{ ...item, text: String(item.text || ''), imageBucket: item.imageBucket || location?.bucket || null, imagePath: item.imagePath || location?.path || null } as Message];
  });
}
function mapServer(item: ServerMessage): Message {
  return { id: item.id, role: item.role === 'assistant' ? 'iris' : 'user', text: item.content || '', imageUrl: item.image_url || null, imageBucket: item.image_bucket || null, imagePath: item.image_path || null, createdAt: item.created_at || null, clientMessageId: item.client_message_id || null };
}

function Bubble({ message, themeMode }: { message: Message; themeMode: IrisThemeMode }) {
  const user = message.role === 'user';
  const theme = getIrisTheme(themeMode);
  return (
    <LinearGradient
      colors={user ? theme.userBubbleGradient : theme.irisBubbleGradient}
      style={[styles.bubble, user ? styles.userBubble : styles.irisBubble, { borderColor: theme.bubbleBorder, shadowColor: theme.shadow }]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><GlassShimmer borderRadius={16} /></View>
      <RichText text={message.text} style={[styles.text, { color: theme.text }]} />
    </LinearGradient>
  );
}

function ImageBubble({ message, refreshUrl, themeMode }: { message: Message; refreshUrl: () => Promise<string | null>; themeMode: IrisThemeMode }) {
  const theme = getIrisTheme(themeMode);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(message.imageUrl || '');
  const refreshing = useRef(false);
  useEffect(() => setUrl(message.imageUrl || ''), [message.imageUrl]);
  const refresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { const next = await refreshUrl(); if (next) setUrl(next); }
    finally { refreshing.current = false; }
  };
  return (
    <View style={styles.irisBubble}>
      <LinearGradient colors={theme.irisBubbleGradient} style={[styles.bubble, styles.irisBubble, styles.imageBubble, { borderColor: theme.bubbleBorder, shadowColor: theme.shadow }]}> 
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><GlassShimmer borderRadius={16} /></View>
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button">
          <Image source={{ uri: url }} style={[styles.generatedImage, { backgroundColor: theme.surfaceSoft }]} contentFit="cover" onError={() => void refresh()} />
          <Text style={[styles.imageHint, { color: theme.textFaint }]}>klikni pre celú veľkosť 🔍</Text>
        </Pressable>
        {!!message.text && <RichText text={message.text} style={[styles.text, styles.imageCaption, { color: theme.text }]} />}
      </LinearGradient>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.fullscreen} onPress={() => setOpen(false)}>
          <Image source={{ uri: url }} style={styles.fullscreenImage} contentFit="contain" onError={() => void refresh()} />
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { loading, user, accessToken, signOut } = useAuth();
  const [messages, setMessages] = useState<Message[]>([{ role: 'iris', text: 'Ahoj. Som Iris.' }]);
  const [historyReady, setHistoryReady] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [background, setBackground] = useState<BackgroundConfig | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [pushStatus, setPushStatus] = useState<WebPushStatus>('disabled');
  const [themeMode, setThemeMode] = useState<IrisThemeMode>(initialThemeMode);
  const activeRequestRef = useRef(false);
  const requestBackgroundedRef = useRef(false);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const theme = getIrisTheme(themeMode);
  const glassWeb = Platform.OS === 'web' ? ({ backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)' } as any) : null;

  const getToken = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token || accessToken, [accessToken]);
  const signCustomAvatar = useCallback(async (userId: string) => {
    const { data, error } = await supabase.storage.from(IRIS_AVATAR_BUCKET).createSignedUrl(irisAvatarPath(userId), 86400);
    if (error || !data?.signedUrl) return null;
    return `${data.signedUrl}${data.signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
  }, []);
  useEffect(() => { if (!loading && !user) router.replace('/auth'); }, [loading, user, router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void storageGet(IRIS_THEME_STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setThemeMode(saved);
    });
  }, []);

  useEffect(() => {
    void storageSet(IRIS_THEME_STORAGE_KEY, themeMode);
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.dataset.irisTheme = themeMode;
    document.documentElement.style.backgroundColor = theme.background;
    document.body.style.backgroundColor = theme.background;
    const root = document.getElementById('root');
    if (root) root.style.backgroundColor = theme.background;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme.background);
  }, [theme.background, themeMode]);

  const refreshServerHistory = useCallback(async () => {
    const token = await getToken();
    if (!token) return [] as Message[];
    try {
      const response = await fetchTimed(`${API_HISTORY}?limit=${MAX_MESSAGES}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return [] as Message[];
      const payload = await response.json();
      const server: Message[] = Array.isArray(payload?.messages) ? payload.messages.map(mapServer) : [];
      if (server.length) setMessages(server);
      return server;
    } catch {
      return [] as Message[];
    }
  }, [getToken]);

  const reconcilePendingReply = useCallback(async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const server = await refreshServerHistory();
      const pendingId = pendingAssistantIdRef.current;
      if (!pendingId || server.some((item) => item.clientMessageId === pendingId)) {
        pendingAssistantIdRef.current = null;
        setIsTyping(false);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    setIsTyping(false);
    return false;
  }, [refreshServerHistory]);

  useEffect(() => {
    if (!user?.id) { setHistoryReady(false); return; }
    let cancelled = false;
    setHistoryReady(false);
    (async () => {
      const server = await refreshServerHistory();
      if (cancelled) return;
      if (server.length) { setHistoryReady(true); return; }
      const raw = await storageGet(storageKey(user.id));
      if (cancelled) return;
      if (raw) { try { const parsed = localMessages(JSON.parse(raw), user.id); if (parsed.length) setMessages(parsed); } catch {} }
      setHistoryReady(true);
    })();
    return () => { cancelled = true; };
  }, [refreshServerHistory, user?.id]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    void getWebPushStatus().then(setPushStatus).catch(() => setPushStatus('disabled'));
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && activeRequestRef.current) requestBackgroundedRef.current = true;
      if (document.visibilityState === 'visible') {
        setTimeout(() => {
          if (pendingAssistantIdRef.current) void reconcilePendingReply();
          else void refreshServerHistory();
        }, 350);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stopPushListener = listenForWebPushReply(() => {
      if (pendingAssistantIdRef.current) void reconcilePendingReply();
      else void refreshServerHistory();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopPushListener();
    };
  }, [reconcilePendingReply, refreshServerHistory]);

  useEffect(() => { if (historyReady && user?.id) void storageSet(storageKey(user.id), JSON.stringify(messages.slice(-MAX_MESSAGES))); }, [historyReady, messages, user?.id]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let fallbackAvatar = DEFAULT_AVATAR_URL;
      try {
        const data: UIManifest = await (await fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`)).json();
        if (cancelled) return;
        setBackground(data?.chatBackground ?? null);
        fallbackAvatar = data?.avatar?.image_url || DEFAULT_AVATAR_URL;
      } catch {
        if (cancelled) return;
        setBackground(null);
      }

      if (user?.id) {
        const customAvatar = await signCustomAvatar(user.id);
        if (cancelled) return;
        setAvatarUrl(customAvatar || fallbackAvatar);
      } else if (!cancelled) {
        setAvatarUrl(fallbackAvatar);
      }
    })();
    return () => { cancelled = true; };
  }, [signCustomAvatar, user?.id]);
  useEffect(() => { requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }, [messages.length, isTyping]);

  const refreshImage = useCallback(async (bucket?: string | null, path?: string | null) => {
    if (!bucket || !path) return null;
    const token = await getToken();
    if (!token) return null;
    const response = await fetchTimed(API_MEDIA_SIGN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ bucket, path }) });
    if (!response.ok) return null;
    return (await response.json())?.image_url || null;
  }, [getToken]);

  const enableNotifications = async () => {
    setMenuOpen(false);
    const token = await getToken();
    if (!token) return;
    try {
      const status = await enableWebPush(token);
      setPushStatus(status);
      if (status === 'enabled') Alert.alert('Iris', 'Notifikácie sú zapnuté. Keď odpíšem na pozadí, iPhone ťa upozorní.');
      else if (status === 'needs_home_screen') Alert.alert('Iris', 'Na iPhone fungujú web push notifikácie pre Iris pridanú na plochu ako web appku.');
      else if (status === 'blocked') Alert.alert('Iris', 'Notifikácie sú v iOS zablokované. Povoľ ich v Nastavenia → Notifikácie → Iris.');
      else if (status === 'unsupported') Alert.alert('Iris', 'Tento prehliadač nepodporuje web push pre Iris.');
    } catch (error: any) {
      Alert.alert('Iris', `Notifikácie sa nepodarilo zapnúť: ${error?.message || 'neznáma chyba'}`);
    }
  };

  const uploadAvatar = async () => {
    setMenuOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Iris', 'Potrebujem prístup k fotogalérii.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled || !result.assets?.[0] || !user?.id) return;
    setAvatarUploading(true);
    try {
      const asset = result.assets[0];
      const contentType = asset.mimeType || 'image/jpeg';
      const path = irisAvatarPath(user.id);
      const blob = await (await fetch(asset.uri)).blob();
      const { error } = await supabase.storage.from(IRIS_AVATAR_BUCKET).upload(path, blob, { upsert: true, contentType, cacheControl: '3600' });
      if (error) throw new Error(error.message);
      const signedUrl = await signCustomAvatar(user.id);
      if (!signedUrl) throw new Error('Nepodarilo sa načítať nový avatar.');
      setAvatarUrl(signedUrl);
    } catch (error: any) {
      Alert.alert('Iris', `Avatar sa nepodarilo zmeniť: ${error?.message || 'neznáma chyba'}`);
    } finally {
      setAvatarUploading(false);
    }
  };

  const uploadReference = async () => {
    setMenuOpen(false);
    if (!user?.id) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Iris', 'Potrebujem prístup k fotogalérii.'); return; }

    Alert.alert(
      'Face reference pack',
      'Vyber postupne 3 fotky tej istej tváre: 1) spredu, 2) 3/4 uhol, 3) profil zboku. Ideálne čistá tvár a časť ramien, bez filtrov.'
    );

    const steps = [
      { slot: 'front', label: 'spredu' },
      { slot: 'three-quarter', label: '3/4' },
      { slot: 'side', label: 'profil' },
    ];
    setUploading(true);
    let uploaded = 0;
    try {
      const token = await getToken();
      if (!token) throw new Error('Nie si prihlásený.');
      for (const step of steps) {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.92 });
        if (result.canceled || !result.assets?.[0]) break;
        const asset = result.assets[0];
        const contentType = asset.mimeType || 'image/jpeg';
        const bucket = 'iris-photos';
        const path = `iris-ref/${user.id}/face-${step.slot}`;
        const blob = await (await fetch(asset.uri)).blob();
        const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType, cacheControl: '3600' });
        if (error) throw new Error(`${step.label}: ${error.message}`);
        uploaded += 1;

        // Keep the front view as the legacy single-reference fallback for older code paths.
        if (step.slot === 'front') {
          const response = await fetchTimed(API_REF_PHOTO, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ bucket, path }) });
          if (!response.ok) throw new Error((await response.text()).slice(0, 180));
        }
      }

      if (uploaded === 3) {
        setMessages((old) => [...old, { role: 'iris', text: 'Face reference pack je hotový — spredu, 3/4 aj profil. 📸' }]);
      } else if (uploaded > 0) {
        Alert.alert('Iris', `Uložené ${uploaded}/3 referenčných fotiek. Spusti nastavenie znova, keď budeš chcieť pack dokončiť alebo nahradiť.`);
      }
    } catch (error: any) {
      Alert.alert('Iris', `Referenčné fotky sa nepodarilo uložiť: ${error?.message || 'neznáma chyba'}`);
    } finally {
      setUploading(false);
    }
  };

  const clearHistory = async () => {
    setMenuOpen(false);
    const token = await getToken();
    if (token) await fetchTimed(API_HISTORY, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    setMessages([{ role: 'iris', text: 'Ahoj. Som Iris.' }]);
  };

  const sendMessage = async (value: string) => {
    const text = value.trim();
    if (!text || isTyping) return;
    const clientId = Crypto.randomUUID();
    const assistantClientId = `${clientId}:assistant`;
    setMenuOpen(false);
    Keyboard.dismiss();
    setMessages((old) => [...old, { id: clientId, role: 'user', text, createdAt: new Date().toISOString(), clientMessageId: clientId }]);
    pendingAssistantIdRef.current = assistantClientId;
    requestBackgroundedRef.current = false;
    activeRequestRef.current = true;
    setIsTyping(true);
    try {
      const token = await getToken();
      if (!token) { router.replace('/auth'); throw new Error('HTTP 401'); }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const response = await fetchTimed(API_CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-timezone': timezone },
        body: JSON.stringify({ message: text, client_message_id: clientId }),
      });
      const raw = await response.text();
      let payload: any = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch {}
      if (!response.ok) {
        if (response.status === 429) throw new Error(`LIMIT:${payload?.used ?? '?'}:${payload?.limit ?? '?'}`);
        throw new Error(`HTTP ${response.status}: ${raw.slice(0, 180)}`);
      }
      pendingAssistantIdRef.current = null;
      setMessages((old) => [...old, { id: Crypto.randomUUID(), role: 'iris', text: payload.reply ?? '…', imageUrl: payload.image_url || null, imageBucket: payload.image_bucket || null, imagePath: payload.image_path || null, createdAt: new Date().toISOString(), clientMessageId: assistantClientId }]);
    } catch (error: any) {
      const backgroundInterrupted = requestBackgroundedRef.current || (Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState !== 'visible');
      if (backgroundInterrupted) {
        if (Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'visible') void reconcilePendingReply();
        return;
      }

      pendingAssistantIdRef.current = null;
      const message = String(error?.message || '');
      let errorText = 'Nastala chyba pri spojení s Iris.';
      if (message.startsWith('LIMIT:')) { const [, used, limit] = message.split(':'); errorText = `Dnešný limit je vyčerpaný (${used}/${limit}).`; }
      else if (message.includes('401')) errorText = 'Prihlásenie neprešlo (401).';
      else if (message.includes('HTTP 5')) errorText = 'Backend je dočasne nedostupný.';
      else if (error?.name === 'AbortError') errorText = 'Odpoveď trvala príliš dlho. Skús to znova.';
      setMessages((old) => [...old, { role: 'iris', text: errorText }]);
    } finally {
      activeRequestRef.current = false;
      if (!pendingAssistantIdRef.current) setIsTyping(false);
    }
  };

  const lastIris = useMemo(() => messages.map((m) => m.role).lastIndexOf('iris'), [messages]);
  const chat = (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}> 
      <View style={[styles.header, glassWeb, { borderBottomColor: theme.headerBorder, backgroundColor: theme.header, shadowColor: theme.shadow }]}> 
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        <View><Text style={[styles.headerName, { color: theme.text }]}>Iris</Text><Text style={[styles.headerStatus, { color: theme.textMuted }]}>with you</Text></View>
        <View style={styles.menuWrap}>
          <Pressable onPress={() => setMenuOpen((open) => !open)} style={[styles.menuBtn, { backgroundColor: theme.surfaceSoft, borderColor: theme.surfaceBorder }]}><Text style={[styles.menuDots, { color: theme.text }]}>⋯</Text></Pressable>
          {menuOpen && <View style={[styles.menu, glassWeb, { backgroundColor: theme.surface, borderColor: theme.surfaceBorder, shadowColor: theme.shadow }]}> 
            <Text style={[styles.menuLabel, { color: theme.textMuted }]}>Vzhľad</Text>
            <View style={[styles.themeSwitch, { backgroundColor: theme.surfaceSoft, borderColor: theme.surfaceBorder }]}> 
              {(['dark', 'light'] as IrisThemeMode[]).map((mode) => {
                const selected = themeMode === mode;
                return (
                  <Pressable key={mode} onPress={() => setThemeMode(mode)} style={[styles.themeOption, selected && { backgroundColor: theme.accent }]}> 
                    <Text style={[styles.themeOptionText, { color: selected ? '#fff' : theme.text }]}>{mode === 'dark' ? 'Dark' : 'Light'}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.menuDivider, { backgroundColor: theme.surfaceBorder }]} />
            {Platform.OS === 'web' && <Pressable onPress={() => void enableNotifications()} style={styles.menuItem}><Text style={[styles.menuText, { color: theme.text }]}>{pushStatus === 'enabled' ? '🔔 Notifikácie zapnuté' : '🔔 Povoliť notifikácie'}</Text></Pressable>}
            <Pressable onPress={() => void uploadAvatar()} style={styles.menuItem}>{avatarUploading ? <ActivityIndicator color={theme.text} /> : <Text style={[styles.menuText, { color: theme.text }]}>🖼️ Zmeniť avatar Iris</Text>}</Pressable>
            <Pressable onPress={() => void uploadReference()} style={styles.menuItem}>{uploading ? <ActivityIndicator color={theme.text} /> : <Text style={[styles.menuText, { color: theme.text }]}>🧬 Face reference pack (3)</Text>}</Pressable>
            <Pressable onPress={() => void clearHistory()} style={styles.menuItem}><Text style={[styles.menuText, { color: theme.text }]}>Vymazať históriu</Text></Pressable>
            <Pressable onPress={async () => { setMenuOpen(false); await signOut(); router.replace('/auth'); }} style={styles.menuItem}><Text style={[styles.menuText, { color: theme.text }]}>Odhlásiť sa</Text></Pressable>
          </View>}
        </View>
      </View>
      {menuOpen && <Pressable onPress={() => setMenuOpen(false)} style={styles.menuOverlay} />}
      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => setMenuOpen(false)}>
        {messages.map((message, index) => message.role === 'iris' && message.imageUrl
          ? <ImageBubble key={message.id || `img-${index}`} message={message} themeMode={themeMode} refreshUrl={() => refreshImage(message.imageBucket, message.imagePath)} />
          : <Bubble key={message.id || `${message.role}-${index}-${lastIris}`} message={message} themeMode={themeMode} />)}
        {isTyping && <View style={styles.typing}><TypingIndicator themeMode={themeMode} /></View>}
      </ScrollView>
      <View style={{ paddingBottom: Platform.OS === 'web' ? 0 : Math.max(insets.bottom, 10) }}><ChatInput onSend={sendMessage} disabled={isTyping} themeMode={themeMode} /></View>
    </View>
  );

  const body = Platform.OS === 'web'
    ? <View style={[styles.root, { backgroundColor: theme.background }]}>{chat}</View>
    : <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{chat}</KeyboardAvoidingView>;
  const statusBar = <StatusBar style={themeMode === 'light' ? 'dark' : 'light'} />;
  if (background?.image_url) {
    const overlayColor = themeMode === 'dark' ? `rgba(0,0,0,${background.overlay ?? 0.35})` : theme.backgroundOverlay;
    return <ImageBackground source={{ uri: background.image_url }} style={[styles.root, { backgroundColor: theme.background }]} blurRadius={background.blur ?? 0}><View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: overlayColor }]} /><SafeAreaView style={[styles.root, { backgroundColor: 'transparent' }]}>{statusBar}{body}</SafeAreaView></ImageBackground>;
  }
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>{statusBar}{body}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, zIndex: 5, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.10, shadowRadius: 18, elevation: 4 },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  headerName: { fontSize: 18, fontWeight: '700' },
  headerStatus: { fontSize: 12, marginTop: 2 },
  menuWrap: { marginLeft: 'auto' },
  menuBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  menuDots: { fontSize: 18 },
  menu: { position: 'absolute', right: 0, top: 42, minWidth: 228, padding: 9, borderRadius: 16, borderWidth: 1, zIndex: 6, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.16, shadowRadius: 28, elevation: 10 },
  menuLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 7 },
  themeSwitch: { flexDirection: 'row', borderRadius: 12, padding: 3, borderWidth: 1, marginHorizontal: 3, marginBottom: 7 },
  themeOption: { flex: 1, minHeight: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  themeOptionText: { fontSize: 13, fontWeight: '700' },
  menuDivider: { height: 1, marginVertical: 5, marginHorizontal: 4 },
  menuItem: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 9 },
  menuText: { fontSize: 14 },
  menuOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 4 },
  messages: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },
  messagesContent: { paddingBottom: 12 },
  bubble: { maxWidth: '85%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, marginBottom: 8, overflow: 'hidden', borderWidth: 1, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 1 },
  userBubble: { alignSelf: 'flex-end' },
  irisBubble: { alignSelf: 'flex-start' },
  text: { fontSize: 15, lineHeight: 20 },
  imageBubble: { padding: 8 },
  generatedImage: { width: 240, height: 240, borderRadius: 12 },
  imageHint: { fontSize: 11, textAlign: 'center', marginTop: 4 },
  imageCaption: { marginTop: 8, paddingHorizontal: 4 },
  fullscreen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  fullscreenImage: { width: '100%', height: '88%' },
  close: { position: 'absolute', top: Platform.OS === 'web' ? 24 : 50, right: 24, color: '#fff', fontSize: 28, fontWeight: '700' },
  typing: { height: 26, marginLeft: 8 },
});