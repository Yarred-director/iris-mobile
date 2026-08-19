import { getIrisTheme, type IrisThemeMode } from '@/constants/irisTheme';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export default function TypingIndicator({ themeMode = 'dark' }: { themeMode?: IrisThemeMode }) {
  const theme = getIrisTheme(themeMode);
  const dots = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
  ];

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ]),
      ).start();

    dots.forEach((dot, i) => animate(dot, i * 150));
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.typingBackground, borderColor: theme.surfaceBorder }]}> 
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: theme.typingDot,
              opacity: dot,
              transform: [{ scale: dot.interpolate({ inputRange: [0.3, 1], outputRange: [0.85, 1] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginHorizontal: 3,
  },
});
