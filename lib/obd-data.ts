import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ObdLiveData } from './obd-ble';
import { supabase } from './supabase';

export type ObdReading = {
  vehicleId: string;
  rpm: number | null;
  speedKmh: number | null;
  coolantTempC: number | null;
  batteryVoltage: number | null;
  fuelPercent: number | null;
  dtcCount: number | null;
  recordedAt: string;
};

export type ObdSnapshot = Record<string, ObdReading>;

export type ObdInput = {
  rpm: string;
  speedKmh: string;
  coolantTempC: string;
  batteryVoltage: string;
  fuelPercent: string;
  dtcCount: string;
};

type ObdLogRow = {
  vehicle_id: string | null;
  rpm: number | null;
  speed_kmh: number | null;
  coolant_temp_c: number | null;
  battery_voltage: number | null;
  fuel_percent: number | null;
  dtc_count: number | null;
  recorded_at: string | null;
};

const STORAGE_KEY = 'vehicle-obd-readings-v1';
const REQUEST_TIMEOUT_MS = 8_000;

export const EMPTY_OBD_INPUT: ObdInput = {
  rpm: '',
  speedKmh: '',
  coolantTempC: '',
  batteryVoltage: '',
  fuelPercent: '',
  dtcCount: '',
};

async function withRequestTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 응답 시간이 초과되었습니다.`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isMissingObdTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /obd_logs|does not exist|schema cache|could not find/i.test(error.message);
}

function parseOptionalNumber(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} 값을 숫자로 입력해 주세요.`);
  }

  return parsed;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeReading(value: unknown, vehicleId: string): ObdReading | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<ObdReading>;
  return {
    vehicleId,
    rpm: normalizeNumber(source.rpm),
    speedKmh: normalizeNumber(source.speedKmh),
    coolantTempC: normalizeNumber(source.coolantTempC),
    batteryVoltage: normalizeNumber(source.batteryVoltage),
    fuelPercent: normalizeNumber(source.fuelPercent),
    dtcCount: normalizeNumber(source.dtcCount),
    recordedAt: typeof source.recordedAt === 'string' ? source.recordedAt : new Date().toISOString(),
  };
}

function rowToReading(row: ObdLogRow): ObdReading | null {
  if (!row.vehicle_id) {
    return null;
  }

  return {
    vehicleId: row.vehicle_id,
    rpm: normalizeNumber(row.rpm),
    speedKmh: normalizeNumber(row.speed_kmh),
    coolantTempC: normalizeNumber(row.coolant_temp_c),
    batteryVoltage: normalizeNumber(row.battery_voltage),
    fuelPercent: normalizeNumber(row.fuel_percent),
    dtcCount: normalizeNumber(row.dtc_count),
    recordedAt: row.recorded_at ?? new Date().toISOString(),
  };
}

export function inputFromReading(reading: ObdReading | null | undefined): ObdInput {
  if (!reading) {
    return { ...EMPTY_OBD_INPUT };
  }

  return {
    rpm: reading.rpm === null ? '' : String(reading.rpm),
    speedKmh: reading.speedKmh === null ? '' : String(reading.speedKmh),
    coolantTempC: reading.coolantTempC === null ? '' : String(reading.coolantTempC),
    batteryVoltage: reading.batteryVoltage === null ? '' : String(reading.batteryVoltage),
    fuelPercent: reading.fuelPercent === null ? '' : String(reading.fuelPercent),
    dtcCount: reading.dtcCount === null ? '' : String(reading.dtcCount),
  };
}

export function buildObdReading(vehicleId: string, input: ObdInput): ObdReading {
  const reading: ObdReading = {
    vehicleId,
    rpm: parseOptionalNumber(input.rpm, 'RPM'),
    speedKmh: parseOptionalNumber(input.speedKmh, '속도'),
    coolantTempC: parseOptionalNumber(input.coolantTempC, '냉각수 온도'),
    batteryVoltage: parseOptionalNumber(input.batteryVoltage, '배터리 전압'),
    fuelPercent: parseOptionalNumber(input.fuelPercent, '연료 잔량'),
    dtcCount: parseOptionalNumber(input.dtcCount, '고장 코드 수'),
    recordedAt: new Date().toISOString(),
  };

  const hasAnyValue = Object.entries(reading).some(
    ([key, value]) => key !== 'vehicleId' && key !== 'recordedAt' && value !== null
  );

  if (!hasAnyValue) {
    throw new Error('저장할 OBD 값을 하나 이상 입력해 주세요.');
  }

  if (reading.rpm !== null && reading.rpm < 0) throw new Error('RPM은 0 이상이어야 합니다.');
  if (reading.speedKmh !== null && reading.speedKmh < 0) throw new Error('속도는 0 이상이어야 합니다.');
  if (reading.fuelPercent !== null && (reading.fuelPercent < 0 || reading.fuelPercent > 100)) {
    throw new Error('연료 잔량은 0~100 사이로 입력해 주세요.');
  }
  if (reading.dtcCount !== null && reading.dtcCount < 0) throw new Error('고장 코드 수는 0 이상이어야 합니다.');

  return reading;
}

export async function loadObdSnapshot(): Promise<ObdSnapshot> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([vehicleId, value]) => [vehicleId, normalizeReading(value, vehicleId)] as const)
        .filter((entry): entry is readonly [string, ObdReading] => entry[1] !== null)
    );
  } catch {
    return {};
  }
}

async function saveObdSnapshot(snapshot: ObdSnapshot) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export async function loadSyncedObdSnapshot(vehicleIds: string[]): Promise<{ snapshot: ObdSnapshot; message: string }> {
  const localSnapshot = await loadObdSnapshot();
  if (vehicleIds.length === 0) {
    return { snapshot: localSnapshot, message: '차량 없음' };
  }

  const result = await withRequestTimeout(
    supabase
      .from('obd_logs')
      .select('vehicle_id,rpm,speed_kmh,coolant_temp_c,battery_voltage,fuel_percent,dtc_count,recorded_at')
      .in('vehicle_id', vehicleIds)
      .order('recorded_at', { ascending: false })
      .limit(200),
    'OBD 기록'
  );

  if (result.error) {
    if (isMissingObdTable(result.error)) {
      return { snapshot: localSnapshot, message: 'DB OBD 테이블 준비 전' };
    }
    return { snapshot: localSnapshot, message: result.error.message };
  }

  const merged: ObdSnapshot = { ...localSnapshot };
  for (const row of (result.data ?? []) as ObdLogRow[]) {
    const reading = rowToReading(row);
    if (!reading || merged[reading.vehicleId]) {
      continue;
    }
    merged[reading.vehicleId] = reading;
  }

  await saveObdSnapshot(merged);
  return { snapshot: merged, message: 'Supabase 동기화' };
}

export async function saveObdReading(reading: ObdReading): Promise<{ snapshot: ObdSnapshot; message: string }> {
  const localSnapshot = await loadObdSnapshot();
  const nextSnapshot = { ...localSnapshot, [reading.vehicleId]: reading };
  await saveObdSnapshot(nextSnapshot);

  const result = await withRequestTimeout(
    supabase.from('obd_logs').insert({
      vehicle_id: reading.vehicleId,
      rpm: reading.rpm,
      speed_kmh: reading.speedKmh,
      coolant_temp_c: reading.coolantTempC,
      battery_voltage: reading.batteryVoltage,
      fuel_percent: reading.fuelPercent,
      dtc_count: reading.dtcCount,
      recorded_at: reading.recordedAt,
    }),
    'OBD 기록 저장'
  );

  if (!result.error) {
    return { snapshot: nextSnapshot, message: 'Supabase 저장 완료' };
  }

  if (isMissingObdTable(result.error)) {
    return { snapshot: nextSnapshot, message: 'DB OBD 테이블 준비 전, 로컬 저장 완료' };
  }

  return { snapshot: nextSnapshot, message: `로컬 저장 완료, DB 저장 실패: ${result.error.message}` };
}


// Save a BLE-polled OBD snapshot tied to an active trip.
// Non-fatal: silently ignores DB errors so a failed save never interrupts driving.
export async function saveTripObdLog(vehicleId: string, tripId: string, data: ObdLiveData): Promise<void> {
  try {
    await supabase.from('obd_logs').insert({
      vehicle_id: vehicleId,
      trip_id: tripId,
      speed_kmh: data.speedKmh,
      rpm: data.rpm,
      coolant_temp_c: data.coolantC,
      battery_voltage: data.batteryV,
      fuel_level_percent: data.fuelPercent,
      ignition_status: data.rpm !== null && data.rpm > 0 ? 'on' : 'off',
      recorded_at: new Date().toISOString(),
    });
  } catch { /* ignore — driving must not be interrupted by save failures */ }
}
