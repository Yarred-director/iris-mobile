import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import {
    Animated,
    StyleSheet,
    View,
    type DimensionValue,
} from 'react-native';

type Props = {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
};

export default function GlassShimmer({
  width = '100%',
  height = '100%',
  borderRadius = 16,
}: Props) {
  const translateX = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = () => {
      translateX.setValue(-120);
      opacity.setValue(0);

      Animated.sequence([
        Animated.delay(900),
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: 220,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start(() => run());
    };

    run();
  }, []);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        { width, height, borderRadius },
      ]}
    >
      <Animated.View
        style={[
          styles.shimmer,
          {
            transform: [{ translateX }],
            opacity,
            borderRadius,
          },
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.25)',
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
    overflow: 'hidden',
  },
  shimmer: {
    ...StyleSheet.absoluteFillObject,
    width: '40%',
  },
});
