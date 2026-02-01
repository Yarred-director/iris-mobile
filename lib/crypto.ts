import "react-native-get-random-values";

// V RN dev builde stačí, že existuje getRandomValues.
// react-native-get-random-values to typicky nastaví do globalThis.crypto.
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = {};
}
