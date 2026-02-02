import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl) throw new Error("EXPO_PUBLIC_SUPABASE_URL is required.");
if (!supabaseAnonKey) throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY is required.");

// Web storage (SSR-safe)
const webStorage = {
  getItem: async (key: string) => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
  removeItem: async (key: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {}
  },
};

// Native storage (only require on native runtime)
let nativeStorage: any = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeStorage = require("@react-native-async-storage/async-storage").default;
}

const storage = Platform.OS === "web" ? webStorage : nativeStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === "web",
    flowType: "pkce", // <-- makes web callback stable (code=)
  },
});
