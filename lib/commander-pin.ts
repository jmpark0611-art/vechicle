import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_KEY = '@commander_pin';

export async function getStoredPin(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PIN_KEY);
  } catch {
    return null;
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
  return stored !== null && stored === pin;
}
