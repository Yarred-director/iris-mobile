export type IrisThemeMode = 'dark' | 'light';

export const IRIS_THEME_STORAGE_KEY = 'iris.ui.theme.v1';

export const IRIS_THEMES = {
  dark: {
    background: '#0b0b0f',
    canvas: '#0b0b0f',
    header: 'rgba(0,0,0,0.50)',
    headerBorder: 'rgba(255,255,255,0.12)',
    surface: 'rgba(20,20,26,0.98)',
    surfaceSoft: 'rgba(255,255,255,0.06)',
    surfaceBorder: 'rgba(255,255,255,0.10)',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.68)',
    textFaint: 'rgba(255,255,255,0.40)',
    inputBackground: '#1a1a1f',
    inputBar: 'rgba(0,0,0,0.35)',
    inputBorder: 'rgba(255,255,255,0.15)',
    placeholder: '#9ca3af',
    accent: '#5b6cff',
    userBubbleGradient: ['rgba(91,108,255,0.32)', 'rgba(91,108,255,0.12)'] as [string, string],
    irisBubbleGradient: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)'] as [string, string],
    bubbleBorder: 'rgba(255,255,255,0.10)',
    typingBackground: 'rgba(255,255,255,0.08)',
    typingDot: '#cbd5f5',
    backgroundOverlay: 'rgba(0,0,0,0.35)',
    shadow: 'rgba(0,0,0,0.35)',
  },
  light: {
    background: '#eef0f3',
    canvas: '#f4f5f7',
    header: 'rgba(255,255,255,0.78)',
    headerBorder: 'rgba(17,24,39,0.08)',
    surface: 'rgba(255,255,255,0.94)',
    surfaceSoft: 'rgba(255,255,255,0.58)',
    surfaceBorder: 'rgba(17,24,39,0.09)',
    text: '#17181c',
    textMuted: 'rgba(23,24,28,0.62)',
    textFaint: 'rgba(23,24,28,0.42)',
    inputBackground: 'rgba(255,255,255,0.86)',
    inputBar: 'rgba(246,247,249,0.82)',
    inputBorder: 'rgba(17,24,39,0.10)',
    placeholder: '#7d8490',
    accent: '#5867f2',
    userBubbleGradient: ['rgba(91,108,255,0.20)', 'rgba(91,108,255,0.09)'] as [string, string],
    irisBubbleGradient: ['rgba(255,255,255,0.94)', 'rgba(247,248,250,0.76)'] as [string, string],
    bubbleBorder: 'rgba(17,24,39,0.08)',
    typingBackground: 'rgba(255,255,255,0.72)',
    typingDot: '#6e7894',
    backgroundOverlay: 'rgba(244,245,247,0.82)',
    shadow: 'rgba(32,39,51,0.14)',
  },
} as const;

export function getIrisTheme(mode: IrisThemeMode) {
  return IRIS_THEMES[mode] || IRIS_THEMES.dark;
}
