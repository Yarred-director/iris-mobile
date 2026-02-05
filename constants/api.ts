// constants/api.ts

// Backend base URL
// lokálne / dev / prod si vieš neskôr prepínať
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  "https://iris-mobile.onrender.com";