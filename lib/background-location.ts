import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { enqueueGpsPoint } from './gps-queue';
import { evaluateSpeedZoneAlerts, type VehiclePosition } from './location-data';
import { overspeedWarningKey, showBackgroundOverspeedWarning } from './overspeed-warning';
import { fetchActiveTrips } from './readonly-data';
import { supabase } from './supabase';

export const ACTIVE_TRIP_LOCATION_TASK = 'vehicle-active-trip-location';

const ACTIVE_TRIP_IDS_KEY = '@vehicle_active_background_trip_ids';
const ACTIVE_TRIP_OVERSPEED_KEY = '@vehicle_active_background_overspeed_key';
const ACTIVE_TRIP_LAST_LOCATION_KEY = '@vehicle_active_background_last_location';

type LocationTaskData = {
  locations?: Location.LocationObject[];
};

type StoredLocationSample = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

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

async function setStoredTripIds(tripIds: string[]) {
  const uniqueIds = Array.from(new Set(tripIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    await AsyncStorage.removeItem(ACTIVE_TRIP_IDS_KEY);
    await AsyncStorage.removeItem(ACTIVE_TRIP_OVERSPEED_KEY);
    await AsyncStorage.removeItem(ACTIVE_TRIP_LAST_LOCATION_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_TRIP_IDS_KEY, JSON.stringify(uniqueIds));
}

async function checkBackgroundOverspeedWarning(
  tripIds: string[],
  latest: Location.LocationObject,
  speedKmh: number | null
) {
  try {
    const activeTripIds = new Set(tripIds);
    const recordedAt = new Date(latest.timestamp).toISOString();
    const activeTrips = await fetchActiveTrips(20);
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
    const previousKey = await AsyncStorage.getItem(ACTIVE_TRIP_OVERSPEED_KEY);
    if (previousKey === nextKey) return;

    await AsyncStorage.setItem(ACTIVE_TRIP_OVERSPEED_KEY, nextKey);
    showBackgroundOverspeedWarning();
  } catch {
    // Background warning must never crash or stop location collection.
  }
}

TaskManager.defineTask(ACTIVE_TRIP_LOCATION_TASK, async ({ data, error }) => {
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
});

export async function startActiveTripBackgroundLocation(tripIds: string[]): Promise<{ ok: boolean; message: string }> {
  const ids = Array.from(new Set(tripIds.filter(Boolean)));
  if (ids.length === 0) {
    await stopActiveTripBackgroundLocation();
    return { ok: true, message: '백그라운드 위치 대상 운행이 없습니다.' };
  }

  await setStoredTripIds(ids);

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
    timeInterval: 10_000,
    distanceInterval: 15,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '차량 운행 중',
      notificationBody: '운행 위치와 제한속도 구역을 확인하고 있습니다.',
      notificationColor: '#2563EB',
    },
  });

  return { ok: true, message: '백그라운드 위치 저장을 시작했습니다.' };
}

export async function stopActiveTripBackgroundLocation(): Promise<void> {
  await setStoredTripIds([]);
  if (Platform.OS === 'web') return;

  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(ACTIVE_TRIP_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(ACTIVE_TRIP_LOCATION_TASK);
    }
  } catch {
    // Stop is best-effort; trip completion should not fail because the OS already stopped the task.
  }
}
