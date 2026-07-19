import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIP_OBD_INTERRUPTION_KEY = 'vehicle-trip-obd-interruption-v1';
export const STALE_OBD_INTERRUPTION_HOURS = 24;

export type TripObdInterruption = {
  tripId: string;
  vehicleId: string | null;
  vehicleNumber: string;
  deviceId: string | null;
  deviceName: string | null;
  disconnectedAt: string;
  gpsDistanceKm: number | null;
};

function isTripObdInterruption(value: Partial<TripObdInterruption>): value is TripObdInterruption {
  return (
    typeof value.tripId === 'string' &&
    value.tripId.length > 0 &&
    typeof value.vehicleNumber === 'string' &&
    value.vehicleNumber.length > 0 &&
    typeof value.disconnectedAt === 'string' &&
    value.disconnectedAt.length > 0
  );
}

export async function saveTripObdInterruption(interruption: TripObdInterruption): Promise<void> {
  await AsyncStorage.setItem(TRIP_OBD_INTERRUPTION_KEY, JSON.stringify(interruption));
}

export async function loadTripObdInterruption(): Promise<TripObdInterruption | null> {
  const raw = await AsyncStorage.getItem(TRIP_OBD_INTERRUPTION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TripObdInterruption>;
    return isTripObdInterruption(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearTripObdInterruption(tripId?: string): Promise<void> {
  if (!tripId) {
    await AsyncStorage.removeItem(TRIP_OBD_INTERRUPTION_KEY);
    return;
  }
  const saved = await loadTripObdInterruption();
  if (!saved || saved.tripId === tripId) {
    await AsyncStorage.removeItem(TRIP_OBD_INTERRUPTION_KEY);
  }
}

export function isStaleObdInterruption(interruption: TripObdInterruption, hours = STALE_OBD_INTERRUPTION_HOURS): boolean {
  const disconnectedAt = new Date(interruption.disconnectedAt).getTime();
  if (!Number.isFinite(disconnectedAt)) return false;
  return Date.now() - disconnectedAt >= hours * 60 * 60 * 1000;
}
