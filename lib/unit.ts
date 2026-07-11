import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const UNIT_CODE_KEY = 'app_unit_code';
const UNIT_NAME_KEY = 'app_unit_name';

export type UnitRecord = { code: string; name: string };

export async function getStoredUnitCode(): Promise<string | null> {
  return AsyncStorage.getItem(UNIT_CODE_KEY);
}

export async function getStoredUnitName(): Promise<string | null> {
  return AsyncStorage.getItem(UNIT_NAME_KEY);
}

export async function setStoredUnit(code: string, name: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(UNIT_CODE_KEY, code),
    AsyncStorage.setItem(UNIT_NAME_KEY, name),
  ]);
}

export async function clearStoredUnit(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(UNIT_CODE_KEY),
    AsyncStorage.removeItem(UNIT_NAME_KEY),
  ]);
}

export async function fetchUnits(): Promise<UnitRecord[]> {
  const { data } = await supabase
    .from('units')
    .select('code, name')
    .order('name', { ascending: true });
  return (data ?? []) as UnitRecord[];
}

export async function verifyCommanderPin(unitCode: string, pin: string): Promise<boolean> {
  const { data } = await supabase
    .from('units')
    .select('commander_pin')
    .eq('code', unitCode)
    .maybeSingle();
  if (!data) return false;
  return (data as { commander_pin: string }).commander_pin === pin;
}
