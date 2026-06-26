import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppRole = 'driver' | 'commander';
const ROLE_KEY = '@app_role';

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
}
