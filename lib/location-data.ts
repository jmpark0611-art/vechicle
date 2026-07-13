import { fetchActiveTrips, type TripSummary } from './readonly-data';
import { supabase } from './supabase';

export type VehiclePosition = {
  tripId: string;
  vehicleNumber: string;
  route: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  recordedAt: string;
};

export type SpeedZone = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  speedLimitKmh: number;
};

export type LocationSnapshot = {
  positions: VehiclePosition[];
  zones: SpeedZone[];
  message: string;
};

type GpsPointRow = {
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  recorded_at: string | null;
};

type SpeedZoneRow = {
  id: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
  speed_limit_kmh: number | null;
};

const REQUEST_TIMEOUT_MS = 10_000;

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

function isMissingTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|could not find/i.test(error.message);
}

function isNoRows(error: { code?: string; message: string } | null) {
  return error?.code === 'PGRST116' || /0 rows|multiple rows/i.test(error?.message ?? '');
}

function routeLabel(trip: TripSummary) {
  return `${trip.startPlace ?? '출발지 없음'} → ${trip.endPlace ?? '목적지 없음'}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function fetchLatestPoint(trip: TripSummary): Promise<VehiclePosition | null> {
  const result = await withRequestTimeout(
    supabase
      .from('gps_points')
      .select('latitude,longitude,speed_kmh,recorded_at')
      .eq('trip_id', trip.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    '최근 GPS'
  );

  if (result.error) {
    if (isMissingTable(result.error) || isNoRows(result.error)) {
      return null;
    }
    throw new Error(result.error.message);
  }

  const point = result.data as GpsPointRow | null;
  if (!point || !isFiniteNumber(point.latitude) || !isFiniteNumber(point.longitude) || !point.recorded_at) {
    return null;
  }

  return {
    tripId: trip.id,
    vehicleNumber: trip.vehicleNumber,
    route: routeLabel(trip),
    latitude: point.latitude,
    longitude: point.longitude,
    speedKmh: isFiniteNumber(point.speed_kmh) ? point.speed_kmh : null,
    recordedAt: point.recorded_at,
  };
}

async function fetchSpeedZones(): Promise<{ zones: SpeedZone[]; message: string }> {
  const result = await withRequestTimeout(
    supabase
      .from('speed_zones')
      .select('id,name,latitude,longitude,radius_m,speed_limit_kmh')
      .order('name', { ascending: true })
      .limit(50),
    '제한속도 구역'
  );

  if (result.error) {
    if (isMissingTable(result.error)) {
      return { zones: [], message: '제한속도 구역 테이블 준비 전' };
    }
    return { zones: [], message: result.error.message };
  }

  const zones = ((result.data ?? []) as SpeedZoneRow[])
    .filter(
      (row) =>
        row.id &&
        isFiniteNumber(row.latitude) &&
        isFiniteNumber(row.longitude) &&
        isFiniteNumber(row.radius_m) &&
        isFiniteNumber(row.speed_limit_kmh)
    )
    .map((row) => ({
      id: row.id,
      name: row.name || '이름 없는 구역',
      latitude: row.latitude as number,
      longitude: row.longitude as number,
      radiusM: row.radius_m as number,
      speedLimitKmh: row.speed_limit_kmh as number,
    }));

  return { zones, message: '제한속도 구역 동기화' };
}

export async function fetchLocationSnapshot(): Promise<LocationSnapshot> {
  const [activeTrips, zoneResult] = await Promise.all([fetchActiveTrips(20), fetchSpeedZones()]);
  const pointResults = await Promise.allSettled(activeTrips.map(fetchLatestPoint));
  const positions = pointResults
    .filter((result): result is PromiseFulfilledResult<VehiclePosition | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((position): position is VehiclePosition => position !== null);
  const failedPoint = pointResults.find((result) => result.status === 'rejected');

  return {
    positions,
    zones: zoneResult.zones,
    message: failedPoint ? '일부 GPS 조회 실패' : zoneResult.message,
  };
}
