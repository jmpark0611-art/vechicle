import AsyncStorage from '@react-native-async-storage/async-storage';

export type MaintenanceKey = 'engineOil' | 'oilFilter' | 'airFilter';

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

const STORAGE_KEY = 'vehicle-maintenance-v1';

export const MAINTENANCE_ITEMS: MaintenanceItem[] = [
  { key: 'engineOil', label: '엔진오일', intervalKm: 10000 },
  { key: 'oilFilter', label: '오일필터', intervalKm: 10000 },
  { key: 'airFilter', label: '에어필터', intervalKm: 15000 },
];

function emptyState(): VehicleMaintenanceState {
  return { currentKm: null, completedKm: {}, updatedAt: null };
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
