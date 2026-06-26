import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'commander_pin';

export async function getStoredPin(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PIN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
}

export async function clearStoredPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await getStoredPin();
  return stored !== null && stored === pin;
}
