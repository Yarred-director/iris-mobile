import { StatusBar } from 'expo-status-bar';
import { ImageBackground, StyleSheet, View } from 'react-native';

type SplashConfig = {
  image_url: string;
  overlay?: number;
  blur?: number;
};

type Props = {
  config: SplashConfig;
};

export default function LoadingScreen({ config }: Props) {
  const overlayOpacity = config.overlay ?? 0.35;
  const blur = config.blur ?? 0;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <ImageBackground
        source={{ uri: config.image_url }}
        style={styles.image}
        resizeMode="cover"
        blurRadius={blur}
      >
        {/* overlay */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(0,0,0,${overlayOpacity})` },
          ]}
        />
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  image: {
    flex: 1,
  },
});
