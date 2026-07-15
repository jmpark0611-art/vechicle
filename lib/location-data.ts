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

export type ZonePoint = {
  latitude: number;
  longitude: number;
};

export type SpeedZone = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  speedLimitKmh: number;
  zoneKind: 'circle' | 'polygon';
  polygonPoints: ZonePoint[];
};

export type SpeedZoneAlert = {
  tripId: string;
  vehicleNumber: string;
  zoneName: string;
  distanceM: number;
  speedKmh: number | null;
  speedLimitKmh: number;
  status: 'inside' | 'overspeed';
};

export type LocationSnapshot = {
  positions: VehiclePosition[];
  zones: SpeedZone[];
  alerts: SpeedZoneAlert[];
  message: string;
};

export type CreateSpeedZoneInput = {
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  speedLimitKmh: number;
  zoneKind?: 'circle' | 'polygon';
  polygonPoints?: ZonePoint[];
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
  zone_kind?: string | null;
  polygon_points?: unknown;
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
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isMissingTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|could not find/i.test(error.message);
}

function isMissingPolygonColumns(error: { message: string } | null) {
  return /zone_kind|polygon_points|schema cache|could not find/i.test(error?.message ?? '');
}

function isNoRows(error: { code?: string; message: string } | null) {
  return error?.code === 'PGRST116' || /0 rows|multiple rows/i.test(error?.message ?? '');
}

function routeLabel(trip: TripSummary) {
  return `${trip.startPlace ?? '출발지 없음'} -> ${trip.endPlace ?? '목적지 없음'}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function distanceMeters(a: ZonePoint, b: ZonePoint) {
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

function normalizePolygonPoints(value: unknown): ZonePoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!point || typeof point !== 'object') return null;
      const source = point as { latitude?: unknown; longitude?: unknown; lat?: unknown; lng?: unknown };
      const latitude = typeof source.latitude === 'number' ? source.latitude : source.lat;
      const longitude = typeof source.longitude === 'number' ? source.longitude : source.lng;
      if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
      return { latitude, longitude };
    })
    .filter((point): point is ZonePoint => point !== null);
}

function isPointInsidePolygon(point: ZonePoint, polygon: ZonePoint[]) {
  if (polygon.length < 3) return false;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersects =
      yi > point.latitude !== yj > point.latitude &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function polygonCenter(points: ZonePoint[]) {
  if (points.length === 0) return null;
  const total = points.reduce(
    (acc, point) => ({
      latitude: acc.latitude + point.latitude,
      longitude: acc.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 }
  );
  return {
    latitude: total.latitude / points.length,
    longitude: total.longitude / points.length,
  };
}

function isPositionInsideZone(position: VehiclePosition, zone: SpeedZone) {
  if (zone.zoneKind === 'polygon' && zone.polygonPoints.length >= 3) {
    return isPointInsidePolygon(position, zone.polygonPoints);
  }
  return distanceMeters(position, zone) <= zone.radiusM;
}

function buildSpeedZoneAlerts(positions: VehiclePosition[], zones: SpeedZone[]): SpeedZoneAlert[] {
  const alerts: SpeedZoneAlert[] = [];

  for (const position of positions) {
    for (const zone of zones) {
      if (!isPositionInsideZone(position, zone)) continue;

      const distanceM = distanceMeters(position, zone);
      const isOverspeed = position.speedKmh !== null && position.speedKmh > zone.speedLimitKmh;
      alerts.push({
        tripId: position.tripId,
        vehicleNumber: position.vehicleNumber,
        zoneName: zone.name,
        distanceM,
        speedKmh: position.speedKmh,
        speedLimitKmh: zone.speedLimitKmh,
        status: isOverspeed ? 'overspeed' : 'inside',
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'overspeed' ? -1 : 1;
    return a.distanceM - b.distanceM;
  });
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
    if (isMissingTable(result.error) || isNoRows(result.error)) return null;
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
  let result: {
    data: unknown[] | null;
    error: { code?: string; message: string } | null;
  } = await withRequestTimeout(
    supabase
      .from('speed_zones')
      .select('id,name,latitude,longitude,radius_m,speed_limit_kmh,zone_kind,polygon_points')
      .order('name', { ascending: true })
      .limit(100),
    '제한속도 구역'
  );

  if (result.error && isMissingPolygonColumns(result.error)) {
    result = await withRequestTimeout(
      supabase
        .from('speed_zones')
        .select('id,name,latitude,longitude,radius_m,speed_limit_kmh')
        .order('name', { ascending: true })
        .limit(100),
      '제한속도 구역'
    );
  }

  if (result.error) {
    if (isMissingTable(result.error)) return { zones: [], message: '제한속도 구역 테이블 준비 전' };
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
      zoneKind: row.zone_kind === 'polygon' ? 'polygon' as const : 'circle' as const,
      polygonPoints: normalizePolygonPoints(row.polygon_points),
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
    alerts: buildSpeedZoneAlerts(positions, zoneResult.zones),
    message: failedPoint ? '일부 GPS 조회 실패' : zoneResult.message,
  };
}

export async function createSpeedZone(input: CreateSpeedZoneInput): Promise<{ ok: boolean; message: string }> {
  const zoneKind = input.zoneKind === 'polygon' ? 'polygon' : 'circle';
  const polygonPoints = zoneKind === 'polygon' ? normalizePolygonPoints(input.polygonPoints) : [];
  const center = zoneKind === 'polygon' ? polygonCenter(polygonPoints) : null;
  const latitude = center?.latitude ?? input.latitude;
  const longitude = center?.longitude ?? input.longitude;
  const radiusM = zoneKind === 'polygon'
    ? Math.max(1, ...polygonPoints.map((point) => distanceMeters(point, { latitude, longitude })))
    : input.radiusM;

  const result = await withRequestTimeout(
    supabase.from('speed_zones').insert({
      name: input.name.trim(),
      latitude,
      longitude,
      radius_m: radiusM,
      speed_limit_kmh: input.speedLimitKmh,
      zone_kind: zoneKind,
      polygon_points: zoneKind === 'polygon' ? polygonPoints : null,
    }),
    '제한속도 구역 저장'
  );

  if (!result.error) return { ok: true, message: '제한속도 구역을 저장했습니다.' };
  if (isMissingTable(result.error)) {
    return { ok: false, message: 'speed_zones 테이블이 아직 DB에 적용되지 않았습니다.' };
  }
  if (isMissingPolygonColumns(result.error)) {
    return {
      ok: false,
      message: '면적 구역용 DB 컬럼이 아직 적용되지 않았습니다. docs/schema.sql의 speed_zones 마이그레이션을 Supabase에 적용해 주세요.',
    };
  }

  return { ok: false, message: result.error.message };
}
