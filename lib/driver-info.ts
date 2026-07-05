import AsyncStorage from '@react-native-async-storage/async-storage';

export const RANKS = [
  '이병', '일병', '상병', '병장',
  '하사', '중사', '상사', '원사', '준위',
  '소위', '중위', '대위', '소령', '중령', '대령',
] as const;

export type DriverRank = (typeof RANKS)[number] | '';

export type DriverInfo = {
  unit: string;
  rank: DriverRank;
  name: string;
};

const KEY = '@driver_info';
const DEFAULT: DriverInfo = { unit: '', rank: '', name: '' };

export async function getDriverInfo(): Promise<DriverInfo> {
  try {
    const value = await AsyncStorage.getItem(KEY);
    if (!value) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(value) };
  } catch {
    return { ...DEFAULT };
  }
}

export async function saveDriverInfo(info: DriverInfo): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    // ignore storage errors
  }
}
