import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

export type MaintenanceKey =
  | 'engineOilSet'
  | 'engineOil'
  | 'oilFilter'
  | 'airFilter'
  | 'fuelFilter'
  | 'coolant'
  | 'brakeOil'
  | 'transmissionOil'
  | 'powerSteeringOil'
  | 'battery'
  | 'tire'
  | 'brakePad'
  | 'wiperBlade'
  | 'sparkPlug'
  | 'timingBelt';

export type MaintenanceItem = {
  key: MaintenanceKey;
  label: string;
  intervalKm: number;
};

export type VehicleMaintenanceState = {
  currentKm: number | null;
  completedKm: Partial<Record<MaintenanceKey, number>>;
  updatedAt: string | null;
};

export type MaintenanceSnapshot = Record<string, VehicleMaintenanceState>;

export type MaintenanceSyncResult = {
  snapshot: MaintenanceSnapshot;
  mode: 'synced' | 'local-only';
  message: string;
};

type MaintenanceRecordRow = {
  vehicle_id: string | null;
  item_key: string | null;
  completed_km: number | null;
  completed_at: string | null;
};

const STORAGE_KEY = 'vehicle-maintenance-v1';
const REQUEST_TIMEOUT_MS = 8_000;

export const MAINTENANCE_ITEMS: MaintenanceItem[] = [
  { key: 'engineOilSet', label: '엔진오일 세트', intervalKm: 10000 },
  { key: 'coolant', label: '냉각수', intervalKm: 40000 },
  { key: 'brakeOil', label: '브레이크오일', intervalKm: 40000 },
  { key: 'transmissionOil', label: '미션오일', intervalKm: 60000 },
  { key: 'powerSteeringOil', label: '파워오일', intervalKm: 50000 },
  { key: 'battery', label: '배터리', intervalKm: 60000 },
  { key: 'tire', label: '타이어', intervalKm: 50000 },
  { key: 'brakePad', label: '브레이크패드', intervalKm: 30000 },
  { key: 'wiperBlade', label: '와이퍼', intervalKm: 10000 },
  { key: 'sparkPlug', label: '점화플러그', intervalKm: 40000 },
  { key: 'timingBelt', label: '타이밍벨트', intervalKm: 100000 },
];

const LEGACY_ENGINE_OIL_SET_KEYS: MaintenanceKey[] = ['engineOil', 'oilFilter', 'airFilter', 'fuelFilter'];

function normalizeMaintenanceKey(value: string | null): MaintenanceKey | null {
  if (!value) return null;
  if (LEGACY_ENGINE_OIL_SET_KEYS.includes(value as MaintenanceKey)) return 'engineOilSet';
  return MAINTENANCE_ITEMS.some((item) => item.key === value) ? (value as MaintenanceKey) : null;
}

function emptyState(): VehicleMaintenanceState {
  return { currentKm: null, completedKm: {}, updatedAt: null };
}

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

function isMissingMaintenanceTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /maintenance_records|does not exist|schema cache|could not find/i.test(error.message)
  );
}

function normalizeKm(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function normalizeState(value: unknown): VehicleMaintenanceState {
  if (!value || typeof value !== 'object') {
    return emptyState();
  }

  const source = value as Partial<VehicleMaintenanceState>;
  const completedSource =
    source.completedKm && typeof source.completedKm === 'object' ? source.completedKm : {};
  const completedKm: Partial<Record<MaintenanceKey, number>> = {};

  for (const item of MAINTENANCE_ITEMS) {
    const km = normalizeKm(completedSource[item.key]);
    if (km !== null) {
      completedKm[item.key] = km;
    }
  }

  if (completedKm.engineOilSet === undefined) {
    const legacyKm = LEGACY_ENGINE_OIL_SET_KEYS.map((key) => normalizeKm(completedSource[key])).filter(
      (km): km is number => km !== null
    );
    if (legacyKm.length > 0) {
      completedKm.engineOilSet = Math.max(...legacyKm);
    }
  }

  return {
    currentKm: normalizeKm(source.currentKm),
    completedKm,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
  };
}

export async function loadMaintenanceSnapshot(): Promise<MaintenanceSnapshot> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([vehicleId, state]) => [vehicleId, normalizeState(state)]));
  } catch {
    return {};
  }
}

export async function loadSyncedMaintenanceSnapshot(vehicleIds: string[]): Promise<MaintenanceSyncResult> {
  const localSnapshot = await loadMaintenanceSnapshot();
  if (vehicleIds.length === 0) {
    return { snapshot: localSnapshot, mode: 'local-only', message: '차량 없음' };
  }

  const result = await withRequestTimeout(
    supabase
      .from('maintenance_records')
      .select('vehicle_id,item_key,completed_km,completed_at')
      .in('vehicle_id', vehicleIds)
      .order('completed_at', { ascending: false })
      .limit(500),
    '정비 기록'
  );

  if (result.error) {
    if (isMissingMaintenanceTable(result.error)) {
      return { snapshot: localSnapshot, mode: 'local-only', message: 'DB 정비 테이블 준비 전' };
    }
    return { snapshot: localSnapshot, mode: 'local-only', message: result.error.message };
  }

  const merged: MaintenanceSnapshot = { ...localSnapshot };
  for (const row of (result.data ?? []) as MaintenanceRecordRow[]) {
    const itemKey = normalizeMaintenanceKey(row.item_key);
    if (!row.vehicle_id || !itemKey) {
      continue;
    }
    const completedKm = normalizeKm(row.completed_km);
    if (completedKm === null) {
      continue;
    }

    const previous = merged[row.vehicle_id] ?? emptyState();
    if (previous.completedKm[itemKey] !== undefined) {
      continue;
    }

    merged[row.vehicle_id] = {
      ...previous,
      completedKm: {
        ...previous.completedKm,
        [itemKey]: completedKm,
      },
      updatedAt: previous.updatedAt ?? row.completed_at ?? new Date().toISOString(),
    };
  }

  await saveMaintenanceSnapshot(merged);
  return { snapshot: merged, mode: 'synced', message: 'Supabase 동기화' };
}

async function saveMaintenanceSnapshot(snapshot: MaintenanceSnapshot) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export async function setVehicleCurrentKm(vehicleId: string, currentKm: number): Promise<MaintenanceSnapshot> {
  const snapshot = await loadMaintenanceSnapshot();
  const previous = snapshot[vehicleId] ?? emptyState();
  snapshot[vehicleId] = {
    ...previous,
    currentKm: Math.max(0, Math.round(currentKm)),
    updatedAt: new Date().toISOString(),
  };
  await saveMaintenanceSnapshot(snapshot);
  return snapshot;
}

export async function mergeVehicleCurrentKm(
  snapshot: MaintenanceSnapshot,
  vehicleKm: Record<string, number>
): Promise<MaintenanceSnapshot> {
  const nextSnapshot: MaintenanceSnapshot = { ...snapshot };
  let changed = false;

  for (const [vehicleId, km] of Object.entries(vehicleKm)) {
    const nextKm = normalizeKm(km);
    if (nextKm === null) continue;

    const previous = nextSnapshot[vehicleId] ?? emptyState();
    if (previous.currentKm !== null && previous.currentKm >= nextKm) continue;

    nextSnapshot[vehicleId] = {
      ...previous,
      currentKm: nextKm,
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }

  if (changed) {
    await saveMaintenanceSnapshot(nextSnapshot);
  }

  return nextSnapshot;
}

export async function completeMaintenanceItem(
  vehicleId: string,
  itemKey: MaintenanceKey,
  currentKm: number
): Promise<MaintenanceSnapshot> {
  const snapshot = await loadMaintenanceSnapshot();
  const previous = snapshot[vehicleId] ?? emptyState();
  const nextKm = Math.max(0, Math.round(currentKm));
  snapshot[vehicleId] = {
    ...previous,
    currentKm: nextKm,
    completedKm: {
      ...previous.completedKm,
      [itemKey]: nextKm,
    },
    updatedAt: new Date().toISOString(),
  };
  await saveMaintenanceSnapshot(snapshot);
  return snapshot;
}

export async function syncMaintenanceCompletion(
  vehicleId: string,
  itemKey: MaintenanceKey,
  currentKm: number
): Promise<{ ok: boolean; message: string }> {
  const result = await withRequestTimeout(
    supabase.from('maintenance_records').insert({
      vehicle_id: vehicleId,
      item_key: itemKey,
      completed_km: Math.max(0, Math.round(currentKm)),
      completed_at: new Date().toISOString(),
    }),
    '정비 교체 기록'
  );

  if (!result.error) {
    return { ok: true, message: 'Supabase 저장 완료' };
  }

  if (isMissingMaintenanceTable(result.error)) {
    return { ok: false, message: 'DB 정비 테이블 준비 전, 로컬 저장 완료' };
  }

  return { ok: false, message: `로컬 저장 완료, DB 저장 실패: ${result.error.message}` };
}

export function getVehicleMaintenanceState(
  snapshot: MaintenanceSnapshot,
  vehicleId: string
): VehicleMaintenanceState {
  return snapshot[vehicleId] ?? emptyState();
}

export function getRemainingKm(state: VehicleMaintenanceState, item: MaintenanceItem): number | null {
  const currentKm = state.currentKm;
  const completedKm = state.completedKm[item.key];
  if (currentKm === null || completedKm === undefined) {
    return null;
  }
  return completedKm + item.intervalKm - currentKm;
}
