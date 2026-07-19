import * as Location from 'expo-location';

import { dequeueAllGpsPoints, enqueueGpsPoint } from './gps-queue';
import { supabase } from './supabase';

export type GpsSaveResult = {
  ok: boolean;
  message: string;
};

type GpsPointRow = {
  trip_id: string | null;
  latitude: number | null;
  longitude: number | null;
  recorded_at: string | null;
};

const REQUEST_TIMEOUT_MS = 12_000;

async function withRequestTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 응답 시간이 초과되었습니다.`)), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isMissingGpsTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /gps_points|does not exist|schema cache|could not find/i.test(error.message);
}

function speedMetersPerSecondToKmh(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value * 3.6;
}

function normalizeSpeedKmh(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10) / 10;
}

function distanceKm(a: GpsPointRow, b: GpsPointRow) {
  if (
    typeof a.latitude !== 'number' ||
    typeof a.longitude !== 'number' ||
    typeof b.latitude !== 'number' ||
    typeof b.longitude !== 'number'
  ) {
    return 0;
  }

  const earthRadiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function flushGpsQueue(): Promise<void> {
  const points = await dequeueAllGpsPoints();
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    trip_id: p.tripId,
    latitude: p.latitude,
    longitude: p.longitude,
    speed_kmh: p.speedKmh,
    recorded_at: p.recordedAt,
  }));
  const result = await supabase.from('gps_points').insert(rows);
  if (result.error) {
    // Re-queue on failure so points aren't lost
    for (const p of points) void enqueueGpsPoint(p);
  }
}

export async function saveCurrentGpsPoint(tripId: string, speedOverrideKmh?: number | null): Promise<GpsSaveResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, message: '위치 권한이 허용되지 않아 GPS 저장을 건너뛰었습니다.' };
  }

  const position = await withRequestTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    '현재 위치'
  );

  const speedKmh = normalizeSpeedKmh(speedOverrideKmh) ?? speedMetersPerSecondToKmh(position.coords.speed);

  // Try to flush any queued points first
  void flushGpsQueue();

  const result = await withRequestTimeout(
    supabase.from('gps_points').insert({
      trip_id: tripId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      speed_kmh: speedKmh,
      recorded_at: new Date(position.timestamp).toISOString(),
    }),
    'GPS 저장'
  );

  if (!result.error) {
    return { ok: true, message: 'GPS 위치를 저장했습니다.' };
  }

  if (isMissingGpsTable(result.error)) {
    return { ok: false, message: 'gps_points 테이블이 아직 DB에 적용되지 않았습니다.' };
  }

  // DB/network error — queue for later retry
  void enqueueGpsPoint({
    tripId,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    speedKmh: speedKmh ?? 0,
    recordedAt: new Date(position.timestamp).toISOString(),
  });
  return { ok: false, message: `GPS를 오프라인 큐에 저장했습니다. (${result.error.message})` };
}

export async function fetchTripGpsDistances(tripIds: string[]): Promise<Record<string, number>> {
  if (tripIds.length === 0) {
    return {};
  }

  const result = await withRequestTimeout(
    supabase
      .from('gps_points')
      .select('trip_id,latitude,longitude,recorded_at')
      .in('trip_id', tripIds)
      .order('trip_id', { ascending: true })
      .order('recorded_at', { ascending: true })
      .limit(5000),
    'GPS 이동거리'
  );

  if (result.error) {
    if (isMissingGpsTable(result.error)) {
      return {};
    }
    throw new Error(result.error.message);
  }

  const byTrip = new Map<string, GpsPointRow[]>();
  for (const row of (result.data ?? []) as GpsPointRow[]) {
    if (!row.trip_id) continue;
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }

  const distances: Record<string, number> = {};
  for (const [tripId, points] of byTrip) {
    let totalKm = 0;
    for (let index = 1; index < points.length; index++) {
      totalKm += distanceKm(points[index - 1], points[index]);
    }
    distances[tripId] = Math.round(totalKm * 10) / 10;
  }

  return distances;
}
