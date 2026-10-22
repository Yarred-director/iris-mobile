import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import source from '../i18n/en.json';

type Strings = Record<string, string>;
type Vars = Record<string, string | number | null | undefined>;
type I18nCtx = { language: string; t: (key: string, vars?: Vars) => string };

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://iris-mobile.onrender.com').trim().replace(/\/+$/, '').replace(/\/chat$/, '');
const CACHE_PREFIX = 'iris.i18n.v1:';
const I18nContext = createContext<I18nCtx | null>(null);

export function deviceLanguage(): string {
  try {
    const raw = (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.language)
      || Intl.DateTimeFormat().resolvedOptions().locale
      || 'en';
    const code = String(raw).toLowerCase().split(/[-_]/)[0];
    return /^[a-z]{2,3}$/.test(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

async function readCache(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    return await (await import('@react-native-async-storage/async-storage')).default.getItem(key);
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: string) {
  try {
    if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); return; }
    await (await import('@react-native-async-storage/async-storage')).default.setItem(key, value);
  } catch {}
}

function fill(template: string, vars: Vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined || vars[name] === null ? `{${name}}` : String(vars[name])));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language] = useState(deviceLanguage);
  const [strings, setStrings] = useState<Strings>(source as Strings);

  useEffect(() => {
    if (language === 'en') return;
    let cancelled = false;
    (async () => {
      const cached = await readCache(CACHE_PREFIX + language);
      if (cached && !cancelled) {
        try { setStrings({ ...(source as Strings), ...JSON.parse(cached) }); } catch {}
      }
      try {
        const response = await fetch(`${API_BASE}/i18n/${language}`);
        const payload = await response.json();
        if (cancelled || !payload?.strings || payload.fallback) return;
        setStrings({ ...(source as Strings), ...payload.strings });
        void writeCache(CACHE_PREFIX + language, JSON.stringify(payload.strings));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [language]);

  const t = useCallback((key: string, vars?: Vars) => fill(strings[key] ?? (source as Strings)[key] ?? key, vars), [strings]);
  const value = useMemo(() => ({ language, t }), [language, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
