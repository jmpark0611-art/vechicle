import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { formatCoord, formatDateTime, formatTripDuration, getTripStatusText, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type Trip = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  end_time: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  status: string | null;
};

type Vehicle = {
  id: string;
  vehicle_number: string;
};

type GpsPoint = {
  id?: string;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  recorded_at: string | null;
};

const GPS_POINT_DISPLAY_LIMIT = 50;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getRecordedAtMs(point: GpsPoint) {
  if (!point.recorded_at) {
    return null;
  }

  const time = new Date(point.recorded_at).getTime();
  return Number.isFinite(time) ? time : null;
}

function getDistanceKm(a: GpsPoint, b: GpsPoint) {
  if (
    a.latitude === null ||
    a.longitude === null ||
    b.latitude === null ||
    b.longitude === null
  ) {
    return 0;
  }

  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatMapPoint(latitude: number | null | undefined, longitude: number | null | undefined) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return `${latitude},${longitude}`;
}

function getTotalDistanceKm(points: GpsPoint[]) {
  const orderedPoints = [...points].reverse();

  return orderedPoints.reduce((total, point, index) => {
    if (index === 0) {
      return total;
    }

    return total + getDistanceKm(orderedPoints[index - 1], point);
  }, 0);
}

function formatGpsDuration(firstPoint: GpsPoint | null, lastPoint: GpsPoint | null) {
  if (!firstPoint || !lastPoint) {
    return '-';
  }

  const firstTime = getRecordedAtMs(firstPoint);
  const lastTime = getRecordedAtMs(lastPoint);

  if (firstTime === null || lastTime === null) {
    return '-';
  }

  const minutes = Math.max(0, Math.round((lastTime - firstTime) / 60000));
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}시간 ${restMinutes}분`;
  }

  return `${restMinutes}분`;
}

function getGpsStats(points: GpsPoint[]) {
  const speeds = points
    .map((point) => point.speed_kmh)
    .filter((speed): speed is number => typeof speed === 'number' && Number.isFinite(speed));
  const pointsWithCoords = points.filter(
    (point) =>
      typeof point.latitude === 'number' &&
      Number.isFinite(point.latitude) &&
      typeof point.longitude === 'number' &&
      Number.isFinite(point.longitude)
  );
  const orderedByTime = [...points].sort((a, b) => {
    const aTime = getRecordedAtMs(a) ?? 0;
    const bTime = getRecordedAtMs(b) ?? 0;
    return aTime - bTime;
  });
  const firstPoint = orderedByTime[0] ?? null;
  const lastPoint = orderedByTime[orderedByTime.length - 1] ?? null;

  return {
    averageSpeed: speeds.length > 0 ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : 0,
    firstPoint,
    lastPoint,
    maxSpeed: speeds.length > 0 ? Math.max(...speeds) : 0,
    pointsWithCoordsCount: pointsWithCoords.length,
    speedSampleCount: speeds.length,
  };
}

export default function TripDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const tripId = Array.isArray(id) ? id[0] : id;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [gpsPoints, setGpsPoints] = useState<GpsPoint[]>([]);
  const [gpsPointCount, setGpsPointCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const vehicleNumber = vehicle?.vehicle_number ?? '차량 정보 없음';
  const latestGps = gpsPoints[0] ?? null;
  const totalDistanceKm = useMemo(() => getTotalDistanceKm(gpsPoints), [gpsPoints]);
  const gpsStats = useMemo(() => getGpsStats(gpsPoints), [gpsPoints]);
  const isStaleRunningTrip = trip?.status === 'in_progress' && isStaleActiveTrip(trip.start_time);

  const loadDetail = useCallback(
    async (refreshing = false) => {
      if (!tripId) {
        setErrorMessage('운행 ID가 없습니다.');
        setIsLoading(false);
        return;
      }

      if (refreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setErrorMessage(null);

      try {
        const tripResult = await withTimeout(
          supabase
            .from('trips')
            .select(
              'id, vehicle_id, start_place, end_place, start_time, end_time, start_lat, start_lng, end_lat, end_lng, status'
            )
            .eq('id', tripId)
            .single(),
          '운행 상세'
        );

        if (tripResult.error) {
          setTrip(null);
          setVehicle(null);
          setGpsPoints([]);
          setGpsPointCount(0);
          setErrorMessage(formatDbError(tripResult.error, '운행 상세를 불러오는 중 오류가 발생했습니다.'));
          return;
        }

        const nextTrip = tripResult.data as Trip;
        setTrip(nextTrip);

        const [vehicleResult, gpsResult] = await Promise.all([
          nextTrip.vehicle_id
            ? withTimeout(
                supabase
                  .from('vehicles')
                  .select('id, vehicle_number')
                  .eq('id', nextTrip.vehicle_id)
                  .maybeSingle(),
                '차량 상세'
              )
            : Promise.resolve({ data: null, error: null }),
          withTimeout(
            supabase
              .from('gps_points')
              .select('latitude, longitude, speed_kmh, recorded_at', { count: 'exact' })
              .eq('trip_id', tripId)
              .order('recorded_at', { ascending: false })
              .limit(GPS_POINT_DISPLAY_LIMIT),
            'GPS 상세'
          ),
        ]);

        if (vehicleResult.error) {
          setVehicle(null);
          setErrorMessage((current) => current ?? formatDbError(vehicleResult.error));
        } else {
          setVehicle((vehicleResult.data ?? null) as Vehicle | null);
        }

        if (gpsResult.error) {
          setGpsPoints([]);
          setGpsPointCount(0);
          setErrorMessage((current) => current ?? formatDbError(gpsResult.error));
        } else {
          setGpsPoints((gpsResult.data ?? []) as GpsPoint[]);
          setGpsPointCount(gpsResult.count ?? gpsResult.data?.length ?? 0);
        }
      } catch (error) {
        setTrip(null);
        setVehicle(null);
        setGpsPoints([]);
        setGpsPointCount(0);
        setErrorMessage(
          formatDbError(error, '운행 상세를 불러오는 중 오류가 발생했습니다.')
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [tripId]
  );

  const handleOpenMap = useCallback(async () => {
    if (!trip) {
      return;
    }

    const start = formatMapPoint(trip.start_lat, trip.start_lng);
    const end = formatMapPoint(trip.end_lat, trip.end_lng) ??
      formatMapPoint(latestGps?.latitude, latestGps?.longitude);

    const query = start && end ? `${start}/${end}` : end ?? start;

    if (!query) {
      Alert.alert('지도 열기 불가', '지도에서 열 좌표가 없습니다.');
      return;
    }

    const url = start && end
      ? `https://www.google.com/maps/dir/${query}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`;

    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('지도 열기 실패', error instanceof Error ? error.message : '지도 앱을 열 수 없습니다.');
    }
  }, [latestGps?.latitude, latestGps?.longitude, trip]);

  const handleCancelTrip = useCallback(() => {
    if (!tripId || trip?.status !== 'in_progress') {
      return;
    }

    Alert.alert('운행 무효 처리', '잘못 시작한 운행을 무효 처리할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '무효 처리',
        style: 'destructive',
        onPress: async () => {
          setIsRefreshing(true);
          setErrorMessage(null);

          try {
            const { error } = await withTimeout(
              supabase
                .from('trips')
                .update({
                  status: 'canceled',
                  end_time: new Date().toISOString(),
                })
                .eq('id', tripId),
              '운행 무효 처리'
            );

            if (error) {
              setErrorMessage(formatDbError(error, '운행 무효 처리 중 오류가 발생했습니다.'));
              return;
            }

            await loadDetail(true);
          } catch (error) {
            setErrorMessage(
              formatDbError(error, '운행 무효 처리 중 오류가 발생했습니다.')
            );
          } finally {
            setIsRefreshing(false);
          }
        },
      },
    ]);
  }, [loadDetail, trip?.status, tripId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom + 40, 56),
          paddingTop: Math.max(insets.top + 24, 32),
        },
      ]}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={() => loadDetail(true)} />
      }>
      <Text style={styles.title}>운행 상세</Text>

      {isLoading && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#1565C0" />
          <Text style={styles.noticeText}>운행 상세를 불러오는 중입니다.</Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>상세 조회 실패: {errorMessage}</Text>
        </View>
      )}

      {trip && (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.vehicleText}>{vehicleNumber}</Text>
              <Text
                style={[
                  styles.statusBadge,
                  trip.status === 'in_progress' && styles.runningBadge,
                  isStaleRunningTrip && styles.staleBadge,
                ]}>
                {isStaleRunningTrip ? '장시간 운행' : getTripStatusText(trip.status)}
              </Text>
            </View>
            <View style={styles.routeRow}>
              <Text style={styles.routeText}>{trip.start_place ?? '출발지'}</Text>
              <Text style={styles.routeArrow}>→</Text>
              <Text style={styles.routeText}>{trip.end_place ?? '목적지'}</Text>
            </View>
            <InfoRow label="출발" value={formatDateTime(trip.start_time)} />
            <InfoRow label="종료" value={formatDateTime(trip.end_time)} />
            <InfoRow label="소요" value={formatTripDuration(trip.start_time, trip.end_time)} />
            {isStaleRunningTrip && (
              <View style={styles.staleBox}>
                <Text style={styles.staleText}>8시간 이상 종료되지 않은 운행입니다. 운행 종료 여부를 확인해 주세요.</Text>
              </View>
            )}
            <InfoRow label="GPS 포인트" value={`${gpsPointCount}개`} />
            {gpsPointCount > gpsPoints.length && (
              <View style={styles.inlineNoticeBox}>
                <Text style={styles.inlineNoticeText}>
                  GPS 기록은 전체 {gpsPointCount}개 중 최근 {gpsPoints.length}개를 표시합니다.
                </Text>
              </View>
            )}
            <InfoRow label="추정 거리" value={`${totalDistanceKm.toFixed(2)} km`} />
            <InfoRow label="평균 속도" value={`${gpsStats.averageSpeed.toFixed(1)} km/h`} />
            <InfoRow label="최고 속도" value={`${gpsStats.maxSpeed.toFixed(1)} km/h`} />
            <InfoRow label="속도 샘플" value={`${gpsStats.speedSampleCount}개`} />
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>좌표</Text>
            <InfoRow label="출발 위도" value={formatCoord(trip.start_lat)} />
            <InfoRow label="출발 경도" value={formatCoord(trip.start_lng)} />
            <InfoRow label="종료 위도" value={formatCoord(trip.end_lat)} />
            <InfoRow label="종료 경도" value={formatCoord(trip.end_lng)} />
            <InfoRow label="좌표 샘플" value={`${gpsStats.pointsWithCoordsCount}개`} />
            <InfoRow label="첫 GPS" value={formatDateTime(gpsStats.firstPoint?.recorded_at ?? null)} />
            <InfoRow label="최근 GPS" value={formatDateTime(gpsStats.lastPoint?.recorded_at ?? latestGps?.recorded_at ?? null)} />
            <InfoRow label="GPS 수집 구간" value={formatGpsDuration(gpsStats.firstPoint, gpsStats.lastPoint)} />
            {gpsPointCount > 0 && gpsStats.pointsWithCoordsCount < 2 && (
              <View style={styles.inlineWarningBox}>
                <Text style={styles.inlineWarningText}>
                  좌표 샘플이 부족해 추정 거리와 경로 품질이 정확하지 않을 수 있습니다.
                </Text>
              </View>
            )}
            {gpsPointCount > 0 && gpsStats.speedSampleCount === 0 && (
              <View style={styles.inlineWarningBox}>
                <Text style={styles.inlineWarningText}>
                  속도 샘플이 없어 평균/최고 속도가 0으로 표시됩니다.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity accessibilityLabel="운행 경로 지도 열기" style={[styles.actionBtn, styles.mapBtn]} onPress={handleOpenMap}>
              <Text style={styles.actionText}>지도 열기</Text>
            </TouchableOpacity>
            <Link href="/explore" asChild>
              <TouchableOpacity accessibilityLabel="운행 기록 화면으로 이동" style={[styles.actionBtn, styles.secondaryBtn]}>
                <Text style={[styles.actionText, styles.secondaryText]}>기록으로</Text>
              </TouchableOpacity>
            </Link>
            {trip.status === 'in_progress' && (
              <>
                <Link href="/" asChild>
                  <TouchableOpacity accessibilityLabel="운행 종료 화면으로 이동" style={styles.actionBtn}>
                    <Text style={styles.actionText}>운행 종료하기</Text>
                  </TouchableOpacity>
                </Link>
                <TouchableOpacity
                  accessibilityLabel="운행 무효 처리"
                  style={[styles.actionBtn, styles.dangerOutlineBtn]}
                  onPress={handleCancelTrip}
                  disabled={isRefreshing}>
                  <Text style={[styles.actionText, styles.dangerOutlineText]}>무효 처리</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <Text style={styles.sectionTitle}>최근 GPS 기록</Text>
          {gpsPoints.length === 0 ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>저장된 GPS 포인트가 없습니다.</Text>
            </View>
          ) : (
            <View style={styles.pointList}>
              {gpsPointCount > gpsPoints.length && (
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeText}>
                    화면 성능을 위해 최근 {GPS_POINT_DISPLAY_LIMIT}개까지만 표시합니다.
                  </Text>
                </View>
              )}
              {gpsPoints.map((point, index) => (
                <View key={`${point.recorded_at ?? 'point'}-${index}`} style={styles.pointCard}>
                  <Text style={styles.pointTitle}>{formatDateTime(point.recorded_at)}</Text>
                  <InfoRow label="위도" value={formatCoord(point.latitude)} />
                  <InfoRow label="경도" value={formatCoord(point.longitude)} />
                  <InfoRow label="속도" value={`${(point.speed_kmh ?? 0).toFixed(1)} km/h`} />
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 14,
    padding: 18,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vehicleText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  statusBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 20,
    color: '#059669',
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  runningBadge: {
    backgroundColor: '#EFF6FF',
    color: '#2563EB',
  },
  staleBadge: {
    backgroundColor: '#FEF2F2',
    color: '#DC2626',
  },
  staleBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    marginBottom: 8,
    marginTop: 6,
    padding: 12,
  },
  staleText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
  },
  inlineNoticeBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    marginBottom: 8,
    marginTop: 6,
    padding: 10,
  },
  inlineNoticeText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '500',
  },
  inlineWarningBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    marginTop: 8,
    padding: 10,
  },
  inlineWarningText: {
    color: '#D97706',
    fontSize: 13,
    fontWeight: '500',
  },
  routeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  routeText: {
    color: '#334155',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  routeArrow: {
    color: '#94A3B8',
    fontSize: 14,
    marginHorizontal: 10,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 30,
  },
  infoLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  infoValue: {
    color: '#334155',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 14,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    flexBasis: 150,
    flexGrow: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryBtn: {
    backgroundColor: '#EFF6FF',
  },
  mapBtn: {
    backgroundColor: '#059669',
  },
  dangerOutlineBtn: {
    backgroundColor: '#FEF2F2',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#2563EB',
  },
  dangerOutlineText: {
    color: '#DC2626',
  },
  pointList: {
    gap: 10,
  },
  pointCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  pointTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#1D4ED8',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '500',
  },
});
