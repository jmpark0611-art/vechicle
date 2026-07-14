import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_KEY = '@commander_pin';
const DEFAULT_PIN = '1862';

export async function getStoredPin(): Promise<string> {
  try {
    const pin = await AsyncStorage.getItem(PIN_KEY);
    return pin ?? DEFAULT_PIN;
  } catch {
    return DEFAULT_PIN;
  }
}

export async function setStoredPin(pin: string): Promise<void> {
  await AsyncStorage.setItem(PIN_KEY, pin);
}

export async function clearStoredPin(): Promise<void> {
  await AsyncStorage.removeItem(PIN_KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await getStoredPin();
  return pin === stored;
}
