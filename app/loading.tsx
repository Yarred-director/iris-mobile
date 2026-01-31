import { StatusBar } from 'expo-status-bar';
import {
  ImageBackground,
  ImageSourcePropType,
  StyleSheet,
  View,
} from 'react-native';

type SplashConfig = {
  image_url: string;
  overlay?: number;
  blur?: number;
};

type Props = {
  config?: SplashConfig | null;
};

// ✅ Fallback obrázok MUSÍ existovať lokálne
const FALLBACK: ImageSourcePropType = require('../assets/images/iris/icons/icon.png');

export default function LoadingScreen({ config }: Props) {
  const overlayOpacity = config?.overlay ?? 0.35;
  const blur = config?.blur ?? 0;

  const source = config?.image_url ? { uri: config.image_url } : FALLBACK;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ImageBackground
        source={source}
        style={styles.image}
        resizeMode="cover"
        blurRadius={blur}
      >
        <View
          style={[
            StyleSheet.absoluteFillObject,
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
