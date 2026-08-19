import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
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
const MAX_MESSAGES = 50;
const REQUEST_TIMEOUT_MS = 300000;

type Message = { id?: string; role: 'user' | 'iris'; text: string; imageUrl?: string | null; imageBucket?: string | null; imagePath?: string | null; createdAt?: string | null; clientMessageId?: string | null };
type BackgroundConfig = { image_url: string; overlay?: number; blur?: number };
type UIManifest = { chatBackground?: BackgroundConfig; avatar?: { image_url?: string } };
type ServerMessage = { id: string; role: 'user' | 'assistant'; content: string; image_url?: string | null; image_bucket?: string | null; image_path?: string | null; created_at?: string | null; client_message_id?: string | null };

function storageKey(userId: string) { return `iris.chat.history.v3:${userId}`; }
async function storageGet(key: string) {
  if (Platform.OS === 'web') { try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; } }
  return (await import('@react-native-async-storage/async-storage')).default.getItem(key);
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') { try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch {} return; }
  await (await import('@react-native-async-storage/async-storage')).default.setItem(key, value);
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

function Bubble({ message }: { message: Message }) {
  const user = message.role === 'user';
  return (
    <LinearGradient colors={user ? ['rgba(91,108,255,0.32)', 'rgba(91,108,255,0.12)'] : ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)']} style={[styles.bubble, user ? styles.userBubble : styles.irisBubble]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><GlassShimmer borderRadius={14} /></View>
      <RichText text={message.text} style={styles.text} />
    </LinearGradient>
  );
}

function ImageBubble({ message, refreshUrl }: { message: Message; refreshUrl: () => Promise<string | null> }) {
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
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)']} style={[styles.bubble, styles.irisBubble, styles.imageBubble]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><GlassShimmer borderRadius={14} /></View>
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button">
          <Image source={{ uri: url }} style={styles.generatedImage} contentFit="cover" onError={() => void refresh()} />
          <Text style={styles.imageHint}>klikni pre celú veľkosť 🔍</Text>
        </Pressable>
        {!!message.text && <RichText text={message.text} style={[styles.text, styles.imageCaption]} />}
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
  const [background, setBackground] = useState<BackgroundConfig | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [pushStatus, setPushStatus] = useState<WebPushStatus>('disabled');
  const activeRequestRef = useRef(false);
  const requestBackgroundedRef = useRef(false);
  const pendingAssistantIdRef = useRef<string | null>(null);

  const getToken = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token || accessToken, [accessToken]);
  useEffect(() => { if (!loading && !user) router.replace('/auth'); }, [loading, user, router]);

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
    fetch(`${UI_MANIFEST_URL}?t=${Date.now()}`).then((r) => r.json()).then((data: UIManifest) => {
      setBackground(data?.chatBackground ?? null);
      setAvatarUrl(data?.avatar?.image_url || DEFAULT_AVATAR_URL);
    }).catch(() => { setBackground(null); setAvatarUrl(DEFAULT_AVATAR_URL); });
  }, []);
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

  const uploadReference = async () => {
    setMenuOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Iris', 'Potrebujem prístup k fotogalérii.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled || !result.assets?.[0] || !user?.id) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const token = await getToken();
      if (!token) throw new Error('Nie si prihlásený.');
      const contentType = asset.mimeType || 'image/jpeg';
      const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const bucket = 'iris-photos';
      const path = `iris-ref/${user.id}/reference.${extension}`;
      const blob = await (await fetch(asset.uri)).blob();
      const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType });
      if (error) throw new Error(error.message);
      const response = await fetchTimed(API_REF_PHOTO, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ bucket, path }) });
      if (!response.ok) throw new Error((await response.text()).slice(0, 180));
      setMessages((old) => [...old, { role: 'iris', text: 'Skvelé! Teraz viem ako vyzerám. Môžeš mi povedať, aby som ti poslala fotku 📸' }]);
    } catch (error: any) { Alert.alert('Iris', `Nepodarilo sa nahrať fotku: ${error?.message || 'neznáma chyba'}`); }
    finally { setUploading(false); }
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        <View><Text style={styles.headerName}>Iris</Text><Text style={styles.headerStatus}>with you</Text></View>
        <View style={styles.menuWrap}>
          <Pressable onPress={() => setMenuOpen((open) => !open)} style={styles.menuBtn}><Text style={styles.menuDots}>⋯</Text></Pressable>
          {menuOpen && <View style={styles.menu}>
            {Platform.OS === 'web' && <Pressable onPress={() => void enableNotifications()} style={styles.menuItem}><Text style={styles.menuText}>{pushStatus === 'enabled' ? '🔔 Notifikácie zapnuté' : '🔔 Povoliť notifikácie'}</Text></Pressable>}
            <Pressable onPress={() => void uploadReference()} style={styles.menuItem}>{uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.menuText}>📸 Nahrať fotku Iris</Text>}</Pressable>
            <Pressable onPress={() => void clearHistory()} style={styles.menuItem}><Text style={styles.menuText}>Vymazať históriu</Text></Pressable>
            <Pressable onPress={async () => { setMenuOpen(false); await signOut(); router.replace('/auth'); }} style={styles.menuItem}><Text style={styles.menuText}>Odhlásiť sa</Text></Pressable>
          </View>}
        </View>
      </View>
      {menuOpen && <Pressable onPress={() => setMenuOpen(false)} style={styles.menuOverlay} />}
      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => setMenuOpen(false)}>
        {messages.map((message, index) => message.role === 'iris' && message.imageUrl
          ? <ImageBubble key={message.id || `img-${index}`} message={message} refreshUrl={() => refreshImage(message.imageBucket, message.imagePath)} />
          : <Bubble key={message.id || `${message.role}-${index}-${lastIris}`} message={message} />)}
        {isTyping && <View style={styles.typing}><TypingIndicator /></View>}
      </ScrollView>
      <View style={{ paddingBottom: Platform.OS === 'web' ? 0 : Math.max(insets.bottom, 10) }}><ChatInput onSend={sendMessage} disabled={isTyping} /></View>
    </View>
  );

  const body = Platform.OS === 'web'
    ? <View style={styles.root}>{chat}</View>
    : <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{chat}</KeyboardAvoidingView>;
  if (background?.image_url) {
    return <ImageBackground source={{ uri: background.image_url }} style={styles.root} blurRadius={background.blur ?? 0}><View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: `rgba(0,0,0,${background.overlay ?? 0.35})` }]} /><SafeAreaView style={styles.root}>{body}</SafeAreaView></ImageBackground>;
  }
  return <SafeAreaView style={styles.root}>{body}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 5 },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  headerName: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerStatus: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  menuWrap: { marginLeft: 'auto' },
  menuBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  menuDots: { color: '#fff', fontSize: 18 },
  menu: { position: 'absolute', right: 0, top: 42, minWidth: 210, padding: 8, borderRadius: 12, backgroundColor: 'rgba(20,20,26,0.98)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', zIndex: 6 },
  menuItem: { paddingVertical: 10, paddingHorizontal: 10 },
  menuText: { color: '#fff', fontSize: 14 },
  menuOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 4 },
  messages: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },
  messagesContent: { paddingBottom: 12 },
  bubble: { maxWidth: '85%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  userBubble: { alignSelf: 'flex-end' },
  irisBubble: { alignSelf: 'flex-start' },
  text: { color: '#fff', fontSize: 15, lineHeight: 20 },
  imageBubble: { padding: 8 },
  generatedImage: { width: 240, height: 240, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  imageHint: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', marginTop: 4 },
  imageCaption: { marginTop: 8, paddingHorizontal: 4 },
  fullscreen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  fullscreenImage: { width: '100%', height: '88%' },
  close: { position: 'absolute', top: Platform.OS === 'web' ? 24 : 50, right: 24, color: '#fff', fontSize: 28, fontWeight: '700' },
  typing: { height: 26, marginLeft: 8 },
});