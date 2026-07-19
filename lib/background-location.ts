import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { enqueueGpsPoint } from './gps-queue';
import { evaluateSpeedZoneAlerts, type VehiclePosition } from './location-data';
import {
  createOverspeedWarningState,
  overspeedWarningKey,
  shouldShowOverspeedWarning,
  showBackgroundOverspeedWarning,
  type OverspeedWarningState,
} from './overspeed-warning';
import { fetchActiveTrips, type TripSummary } from './readonly-data';
import { supabase } from './supabase';

export const ACTIVE_TRIP_LOCATION_TASK = 'vehicle-active-trip-location';

const ACTIVE_TRIP_IDS_KEY = '@vehicle_active_background_trip_ids';
const ACTIVE_TRIP_OVERSPEED_KEY = '@vehicle_active_background_overspeed_key';
const ACTIVE_TRIP_LAST_LOCATION_KEY = '@vehicle_active_background_last_location';
const ACTIVE_TRIP_SUMMARIES_KEY = '@vehicle_active_background_trip_summaries';

type LocationTaskData = {
  locations?: Location.LocationObject[];
};

type StoredLocationSample = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

type StoredTripSummary = Pick<TripSummary, 'id' | 'vehicleNumber' | 'startPlace' | 'endPlace'>;

function speedMetersPerSecondToKmh(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 36) / 10;
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const earthRadiusM = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const haversine =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseOverspeedWarningState(raw: string | null): OverspeedWarningState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OverspeedWarningState>;
    if (typeof parsed.key === 'string' && isFiniteNumber(parsed.lastWarnedAt)) {
      return { key: parsed.key, lastWarnedAt: parsed.lastWarnedAt };
    }
  } catch {
    return { key: raw, lastWarnedAt: 0 };
  }

  return null;
}

function routeLabel(trip: { startPlace?: string | null; endPlace?: string | null }) {
  return `${trip.startPlace ?? '출발지 없음'} -> ${trip.endPlace ?? '목적지 없음'}`;
}

async function getStoredLocationSample(): Promise<StoredLocationSample | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TRIP_LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLocationSample>;
    if (!isFiniteNumber(parsed.latitude) || !isFiniteNumber(parsed.longitude) || !isFiniteNumber(parsed.timestamp)) {
      return null;
    }
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}

async function setStoredLocationSample(latest: Location.LocationObject) {
  const sample: StoredLocationSample = {
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    timestamp: latest.timestamp,
  };
  await AsyncStorage.setItem(ACTIVE_TRIP_LAST_LOCATION_KEY, JSON.stringify(sample));
}

async function resolveSpeedKmh(latest: Location.LocationObject) {
  const nativeSpeed = speedMetersPerSecondToKmh(latest.coords.speed);
  const previous = await getStoredLocationSample();
  await setStoredLocationSample(latest);
  if (nativeSpeed !== null) return nativeSpeed;
  if (!previous) return null;

  const elapsedSeconds = (latest.timestamp - previous.timestamp) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 2 || elapsedSeconds > 300) return null;

  const meters = distanceMeters(previous, latest.coords);
  if (!Number.isFinite(meters) || meters < 5) return 0;

  const estimatedKmh = (meters / elapsedSeconds) * 3.6;
  if (!Number.isFinite(estimatedKmh) || estimatedKmh < 0 || estimatedKmh > 180) return null;
  return Math.round(estimatedKmh * 10) / 10;
}

async function getStoredTripIds() {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TRIP_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
}

function normalizeTripSummary(value: unknown): StoredTripSummary | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<StoredTripSummary>;
  if (typeof source.id !== 'string' || source.id.length === 0) return null;
  return {
    id: source.id,
    vehicleNumber: typeof source.vehicleNumber === 'string' && source.vehicleNumber.length > 0
      ? source.vehicleNumber
      : '차량 미확인',
    startPlace: typeof source.startPlace === 'string' ? source.startPlace : null,
    endPlace: typeof source.endPlace === 'string' ? source.endPlace : null,
  };
}

async function getStoredTripSummaries(): Promise<StoredTripSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TRIP_SUMMARIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeTripSummary)
      .filter((trip): trip is StoredTripSummary => trip !== null);
  } catch {
    return [];
  }
}

async function setStoredTripSummaries(trips: StoredTripSummary[]) {
  const uniqueTrips = Array.from(new Map(trips.map((trip) => [trip.id, trip])).values());
  if (uniqueTrips.length === 0) {
    await AsyncStorage.removeItem(ACTIVE_TRIP_SUMMARIES_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_TRIP_SUMMARIES_KEY, JSON.stringify(uniqueTrips));
}

async function setStoredTripIds(tripIds: string[]) {
  const uniqueIds = Array.from(new Set(tripIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    await AsyncStorage.removeItem(ACTIVE_TRIP_IDS_KEY);
    await AsyncStorage.removeItem(ACTIVE_TRIP_OVERSPEED_KEY);
    await AsyncStorage.removeItem(ACTIVE_TRIP_LAST_LOCATION_KEY);
    await AsyncStorage.removeItem(ACTIVE_TRIP_SUMMARIES_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_TRIP_IDS_KEY, JSON.stringify(uniqueIds));
}

async function refreshStoredTripSummaries(tripIds: string[]) {
  try {
    const activeTripIds = new Set(tripIds);
    const trips = (await fetchActiveTrips(20)).filter((trip) => activeTripIds.has(trip.id));
    await setStoredTripSummaries(trips.map((trip) => ({
      id: trip.id,
      vehicleNumber: trip.vehicleNumber,
      startPlace: trip.startPlace,
      endPlace: trip.endPlace,
    })));
  } catch {
    // Cached summaries are an optimization; background tracking can continue with IDs only.
  }
}

async function getBackgroundTripSummaries(tripIds: string[]) {
  const activeTripIds = new Set(tripIds);
  const cached = (await getStoredTripSummaries()).filter((trip) => activeTripIds.has(trip.id));
  if (cached.length > 0) return cached;

  try {
    const activeTrips = (await fetchActiveTrips(20)).filter((trip) => activeTripIds.has(trip.id));
    if (activeTrips.length > 0) {
      await setStoredTripSummaries(activeTrips.map((trip) => ({
        id: trip.id,
        vehicleNumber: trip.vehicleNumber,
        startPlace: trip.startPlace,
        endPlace: trip.endPlace,
      })));
    }
    return activeTrips;
  } catch {
    return [];
  }
}

async function checkBackgroundOverspeedWarning(
  tripIds: string[],
  latest: Location.LocationObject,
  speedKmh: number | null
) {
  try {
    const activeTripIds = new Set(tripIds);
    const recordedAt = new Date(latest.timestamp).toISOString();
    const activeTrips = await getBackgroundTripSummaries(tripIds);
    const positions: VehiclePosition[] = activeTrips
      .filter((trip) => activeTripIds.has(trip.id))
      .map((trip) => ({
        tripId: trip.id,
        vehicleNumber: trip.vehicleNumber,
        route: routeLabel(trip),
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        speedKmh,
        recordedAt,
      }));

    if (positions.length === 0) {
      await AsyncStorage.removeItem(ACTIVE_TRIP_OVERSPEED_KEY);
      return;
    }

    const { alerts } = await evaluateSpeedZoneAlerts(positions);
    const overspeed = alerts.find((alert) => alert.status === 'overspeed' && activeTripIds.has(alert.tripId));

    if (!overspeed) {
      await AsyncStorage.removeItem(ACTIVE_TRIP_OVERSPEED_KEY);
      return;
    }

    const nextKey = overspeedWarningKey(overspeed);
    const previousState = parseOverspeedWarningState(await AsyncStorage.getItem(ACTIVE_TRIP_OVERSPEED_KEY));
    if (!shouldShowOverspeedWarning(previousState, nextKey)) return;

    await AsyncStorage.setItem(ACTIVE_TRIP_OVERSPEED_KEY, JSON.stringify(createOverspeedWarningState(nextKey)));
    showBackgroundOverspeedWarning();
  } catch {
    // Background warning must never crash or stop location collection.
  }
}

async function handleActiveTripLocationTask({ data, error }: TaskManager.TaskManagerTaskBody<LocationTaskData>) {
  try {
    if (error) return;

    const tripIds = await getStoredTripIds();
    if (tripIds.length === 0) return;

    const locations = (data as LocationTaskData | undefined)?.locations ?? [];
    const latest = locations[locations.length - 1];
    if (!latest) return;

    const recordedAt = new Date(latest.timestamp).toISOString();
    const speedKmh = await resolveSpeedKmh(latest);
    const rows = tripIds.map((tripId) => ({
      trip_id: tripId,
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      speed_kmh: speedKmh,
      recorded_at: recordedAt,
    }));

    const result = await supabase.from('gps_points').insert(rows);

    if (result.error) {
      for (const tripId of tripIds) {
        void enqueueGpsPoint({
          tripId,
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          speedKmh: speedKmh ?? 0,
          recordedAt,
        });
      }
    }

    await checkBackgroundOverspeedWarning(tripIds, latest, speedKmh);
  } catch {
    // Keep the background task alive even if storage, DB, or warning checks fail once.
  }
}

try {
  if (!TaskManager.isTaskDefined(ACTIVE_TRIP_LOCATION_TASK)) {
    TaskManager.defineTask(ACTIVE_TRIP_LOCATION_TASK, handleActiveTripLocationTask);
  }
} catch {
  // App startup must not fail if the native TaskManager module is unavailable or temporarily misconfigured.
}

export async function startActiveTripBackgroundLocation(tripIds: string[]): Promise<{ ok: boolean; message: string }> {
  try {
    const ids = Array.from(new Set(tripIds.filter(Boolean)));
    if (ids.length === 0) {
      await stopActiveTripBackgroundLocation();
      return { ok: true, message: '백그라운드 위치 대상 운행이 없습니다.' };
    }

    await setStoredTripIds(ids);
    void refreshStoredTripSummaries(ids);

    if (Platform.OS === 'web') {
      return { ok: false, message: '웹에서는 백그라운드 위치를 사용할 수 없습니다.' };
    }

    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== Location.PermissionStatus.GRANTED) {
      return { ok: false, message: '위치 권한이 없어 백그라운드 위치를 시작하지 못했습니다.' };
    }

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== Location.PermissionStatus.GRANTED) {
      return { ok: false, message: '백그라운드 위치 권한이 없어 화면이 꺼진 상태의 위치 저장은 제한됩니다.' };
    }

    const hasStarted = await Location.hasStartedLocationUpdatesAsync(ACTIVE_TRIP_LOCATION_TASK);
    if (hasStarted) {
      return { ok: true, message: '백그라운드 위치 저장이 이미 실행 중입니다.' };
    }

    await Location.startLocationUpdatesAsync(ACTIVE_TRIP_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 3_000,
      distanceInterval: 5,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: '차량 운행 중',
        notificationBody: '운행 위치와 제한속도 구역을 확인하고 있습니다.',
        notificationColor: '#2563EB',
      },
    });

    return { ok: true, message: '백그라운드 위치 저장을 시작했습니다.' };
  } catch {
    return {
      ok: false,
      message: '백그라운드 위치는 시작하지 못했지만 운행은 계속할 수 있습니다.',
    };
  }
}

export async function stopActiveTripBackgroundLocation(): Promise<void> {
  try {
    await setStoredTripIds([]);
    if (Platform.OS === 'web') return;

    const hasStarted = await Location.hasStartedLocationUpdatesAsync(ACTIVE_TRIP_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(ACTIVE_TRIP_LOCATION_TASK);
    }
  } catch {
    // Stop is best-effort; trip completion should not fail because the OS already stopped the task.
  }
}
