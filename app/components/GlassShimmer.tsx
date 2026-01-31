import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

type Props = {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  enabled?: boolean;
};

export default function GlassShimmer({
  width = '100%',
  height = '100%',
  borderRadius = 16,
  enabled = true,
}: Props) {
  const translateX = useRef(new Animated.Value(-160)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    const run = () => {
      if (!mounted) return;

      translateX.setValue(-160);
      opacity.setValue(0);

      Animated.sequence([
        Animated.delay(1400),
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: 300,
            duration: 2600, // ✅ pomalšie
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 900, // ✅ pomalší nábeh
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1200, // ✅ pomalší dobeh
          useNativeDriver: true,
        }),
        Animated.delay(2200),
      ]).start(() => run());
    };

    run();

    return () => {
      mounted = false;
      translateX.stopAnimation();
      opacity.stopAnimation();
    };
  }, [enabled, opacity, translateX]);

  if (!enabled) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { width, height, borderRadius }]}
    >
      <Animated.View
        style={[
          styles.shimmer,
          {
            transform: [{ translateX }],
            opacity: opacity.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.10], // ✅ ~10% z pôvodného “wow” (jemné)
            }),
            borderRadius,
          },
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.12)', // ✅ jemný peak
            'rgba(255,255,255,0)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject, // ✅ overlay fill
    overflow: 'hidden',
  },
  shimmer: {
    ...StyleSheet.absoluteFillObject,
    width: '26%', // ✅ užší pás = menej “lacné”
  },
});
