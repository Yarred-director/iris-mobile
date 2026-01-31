import { StatusBar } from 'expo-status-bar';
import { ImageBackground, StyleSheet, View } from 'react-native';

export default function Loading() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ImageBackground
        source={require('../assets/images/iris/icons/splash.png')}
        style={styles.image}
        resizeMode="cover"
      />
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
