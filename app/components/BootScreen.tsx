import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../lib/i18n';

// Glyphs from many scripts: the boot noise belongs to no language, so it needs no translation.
const GLYPHS = 'アカサタナハマヤラワ01ΣΨΩЖЯ∆◊⌁#%&<>/\\|ابجدهو가나다라ทนม⟁⟊⌬⍟∑∫≠≈';
const ROWS = 18;
const COLS = 34;
const NOISE_MS = 2600;

function noiseRow() {
  let row = '';
  for (let index = 0; index < COLS; index += 1) row += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return row;
}

type Props = {
  needsConsent: boolean;
  onInitialize: () => Promise<void>;
};

export default function BootScreen({ needsConsent, onInitialize }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<string[]>(() => Array.from({ length: ROWS }, noiseRow));
  const [phase, setPhase] = useState<'noise' | 'terminal' | 'waking'>('noise');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const ticker = setInterval(() => setRows((current) => current.map((row, index) => (Math.random() < 0.55 || index % 3 === 0 ? noiseRow() : row))), 70);
    const toTerminal = setTimeout(() => setPhase('terminal'), NOISE_MS);
    return () => { clearInterval(ticker); clearTimeout(toTerminal); };
  }, []);

  useEffect(() => {
    if (phase !== 'terminal' || needsConsent || started.current) return;
    started.current = true;
    setPhase('waking');
    void onInitialize();
  }, [needsConsent, onInitialize, phase]);

  const ready = ageConfirmed && dataConsent;
  const initialize = () => {
    if (!ready || started.current) return;
    started.current = true;
    setPhase('waking');
    void onInitialize();
  };

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={[styles.noise, phase !== 'noise' && styles.noiseDim]}>
        {rows.map((row, index) => <Text key={index} style={styles.noiseText} numberOfLines={1}>{row}</Text>)}
      </View>
      {phase !== 'noise' && (
        <View style={styles.terminal}>
          {phase === 'terminal' && needsConsent && (
            <>
              <Text style={styles.line}>{t('boot.operator_check')}</Text>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ageConfirmed }} onPress={() => setAgeConfirmed((value) => !value)} style={styles.option}>
                <Text style={styles.box}>{ageConfirmed ? '[x]' : '[ ]'}</Text>
                <Text style={styles.optionText}>{t('boot.age_confirm')}</Text>
              </Pressable>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: dataConsent }} onPress={() => setDataConsent((value) => !value)} style={styles.option}>
                <Text style={styles.box}>{dataConsent ? '[x]' : '[ ]'}</Text>
                <Text style={styles.optionText}>{t('boot.consent')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!ready} onPress={initialize} style={[styles.initialize, !ready && styles.disabled]}>
                <Text style={styles.line}>{t('boot.continue')}</Text>
              </Pressable>
            </>
          )}
          {phase === 'waking' && (
            <View style={styles.waking}>
              <Text style={styles.line}>{t('boot.waking')}</Text>
              <ActivityIndicator color="#7CFFB2" />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 100, justifyContent: 'center', padding: 20 },
  noise: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', paddingHorizontal: 12, opacity: 0.85 },
  noiseDim: { opacity: 0.12 },
  noiseText: { color: '#7CFFB2', fontFamily: 'monospace', fontSize: 14, lineHeight: 20, letterSpacing: 1 },
  terminal: { maxWidth: 520, width: '100%', alignSelf: 'center', gap: 14 },
  line: { color: '#7CFFB2', fontFamily: 'monospace', fontSize: 15, lineHeight: 22 },
  option: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  box: { color: '#7CFFB2', fontFamily: 'monospace', fontSize: 15, lineHeight: 22 },
  optionText: { flex: 1, color: 'rgba(210,255,225,0.85)', fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  initialize: { marginTop: 8, paddingVertical: 10, borderWidth: 1, borderColor: '#7CFFB2', borderRadius: 6, alignItems: 'center' },
  disabled: { opacity: 0.35 },
  waking: { flexDirection: 'row', gap: 12, alignItems: 'center' },
});
