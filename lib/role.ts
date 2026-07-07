import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppRole = 'driver' | 'commander';
const ROLE_KEY = '@app_role';
const COMMANDER_PIN_VERIFIED_KEY = '@commander_pin_verified';

let commanderPinVerified = false;

function getWebSessionStorage(): Storage | null {
  try {
    const maybeStorage = (globalThis as typeof globalThis & { sessionStorage?: Storage }).sessionStorage;
    return maybeStorage ?? null;
  } catch {
    return null;
  }
}

export async function getStoredRole(): Promise<AppRole | null> {
  try {
    const value = await AsyncStorage.getItem(ROLE_KEY);
    if (value === 'driver' || value === 'commander') return value;
    return null;
  } catch {
    return null;
  }
}

export async function setStoredRole(role: AppRole): Promise<void> {
  await AsyncStorage.setItem(ROLE_KEY, role);
}

export async function clearStoredRole(): Promise<void> {
  await AsyncStorage.removeItem(ROLE_KEY);
  clearCommanderPinVerified();
}

export function markCommanderPinVerified(): void {
  commanderPinVerified = true;
  getWebSessionStorage()?.setItem(COMMANDER_PIN_VERIFIED_KEY, '1');
}

export function isCommanderPinVerified(): boolean {
  if (commanderPinVerified) {
    return true;
  }

  return getWebSessionStorage()?.getItem(COMMANDER_PIN_VERIFIED_KEY) === '1';
}

export function clearCommanderPinVerified(): void {
  commanderPinVerified = false;
  getWebSessionStorage()?.removeItem(COMMANDER_PIN_VERIFIED_KEY);
}
