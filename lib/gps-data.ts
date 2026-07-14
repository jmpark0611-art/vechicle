import * as Location from 'expo-location';

import { supabase } from './supabase';

export type GpsSaveResult = {
  ok: boolean;
  message: string;
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
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isMissingGpsTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /gps_points|does not exist|schema cache|could not find/i.test(error.message);
}

function speedMetersPerSecondToKmh(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value * 3.6;
}

export async function saveCurrentGpsPoint(tripId: string): Promise<GpsSaveResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, message: '위치 권한이 허용되지 않아 GPS 저장을 건너뛰었습니다.' };
  }

  const position = await withRequestTimeout(
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }),
    '현재 위치'
  );

  const result = await withRequestTimeout(
    supabase.from('gps_points').insert({
      trip_id: tripId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      speed_kmh: speedMetersPerSecondToKmh(position.coords.speed),
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

  return { ok: false, message: `GPS 저장 실패: ${result.error.message}` };
}
