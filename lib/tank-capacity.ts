import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'tank-capacity-v1:';

export async function getTankCapacity(vehicleId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + vehicleId);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function setTankCapacity(vehicleId: string, liters: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + vehicleId, String(liters));
  } catch {}
}

export function fuelPctToLiters(pct: number, tankL: number): number {
  return Math.round(((pct / 100) * tankL) * 10) / 10;
}

export function formatFuel(pct: number | null | undefined, tankL: number): string {
  if (typeof pct !== 'number') return '-';
  if (tankL > 0) return `${fuelPctToLiters(pct, tankL)} L`;
  return `${pct}%`;
}

export function formatFuelUsed(startPct: number | null, endPct: number | null, tankL: number): string {
  if (startPct === null || endPct === null || startPct < endPct) return '-';
  const diff = Math.round((startPct - endPct) * 10) / 10;
  if (tankL > 0) return `${Math.round(((diff / 100) * tankL) * 10) / 10} L`;
  return `${diff}%`;
}
