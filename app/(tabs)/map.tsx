import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VehicleMap } from '../../components/vehicle-map';
import { generateVehicleMapHtml, VehiclePosition } from '../../lib/map-html';
import { getStoredRole } from '../../lib/role';
import { supabase } from '../../lib/supabase';

const FALLBACK_POLL_MS = 60_000;
const GPS_STALE_MIN = 5;
const GPS_VERY_STALE_MIN = 30;
const TRIP_STALE_HOURS = 8;

type VehicleSummary = {
  tripId: string;
  vehicleNumber: string;
  startPlace: string | null;
  endPlace: string | null;
  startTime: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  recordedAt: string | null;
};

type GpsStatus = 'fresh' | 'stale' | 'very_stale' | 'no_gps';

function getGpsStatus(recordedAt: string | null): GpsStatus {
  if (!recordedAt) return 'no_gps';
  const ageMin = (Date.now() - new Date(recordedAt).getTime()) / 60000;
  if (ageMin < GPS_STALE_MIN) return 'fresh';
  if (ageMin < GPS_VERY_STALE_MIN) return 'stale';
  return 'very_stale';
}

function isTripLong(startTime: string | null): boolean {
  if (!startTime) return false;
  return Date.now() - new Date(startTime).getTime() > TRIP_STALE_HOURS * 3600 * 1000;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [html, setHtml] = useState('');
  const [summaries, setSummaries] = useState<VehicleSummary[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommander, setIsCommander] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    getStoredRole().then((role) => setIsCommander(role === 'commander'));
  }, []);

  const fetchPositions = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const { data: trips, error: tripError } = await supabase
        .from('trips')
        .select('id, vehicle_id, start_place, end_place, start_time, vehicles(vehicle_number)')
        .eq('status', 'in_progress');

      if (tripError) throw tripError;

      if (!trips || trips.length === 0) {
        setHtml(generateVehicleMapHtml([]));
        setSummaries([]);
        setLastUpdated(new Date());
        setErrorMessage(null);
        setIsLoading(false);
        return;
      }

      const tripIds = trips.map((t) => t.id);
      const { data: gpsData, error: gpsError } = await supabase
        .from('gps_points')
        .select('trip_id, latitude, longitude, speed_kmh, recorded_at')
        .in('trip_id', tripIds)
        .order('recorded_at', { ascending: false })
        .limit(200);

      if (gpsError) throw gpsError;

      const latestByTrip = new Map<string, (typeof gpsData)[0]>();
      for (const point of gpsData ?? []) {
        if (!latestByTrip.has(point.trip_id)) {
          latestByTrip.set(point.trip_id, point);
        }
      }

      const newSummaries: VehicleSummary[] = [];
      const positions: VehiclePosition[] = [];

      for (const trip of trips) {
        const gps = latestByTrip.get(trip.id);
        const veh = trip.vehicles as
          | { vehicle_number?: string }
          | { vehicle_number?: string }[]
          | null;
        const vehicleNumber = Array.isArray(veh)
          ? (veh[0]?.vehicle_number ?? null)
          : (veh?.vehicle_number ?? null);

        newSummaries.push({
          tripId: trip.id,
          vehicleNumber: vehicleNumber ?? '미상',
          startPlace: trip.start_place,
          endPlace: trip.end_place,
          startTime: trip.start_time,
          latitude: gps?.latitude ?? null,
          longitude: gps?.longitude ?? null,
          speedKmh: gps?.speed_kmh ?? null,
          recordedAt: gps?.recorded_at ?? null,
        });

        if (gps && gps.latitude != null && gps.longitude != null) {
          positions.push({
            vehicleNumber: vehicleNumber ?? '미상',
            latitude: gps.latitude,
            longitude: gps.longitude,
            speedKmh: gps.speed_kmh,
            recordedAt: gps.recorded_at,
            startPlace: trip.start_place,
            endPlace: trip.end_place,
          });
        }
      }

      setHtml(generateVehicleMapHtml(positions));
      setSummaries(newSummaries);
      setLastUpdated(new Date());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '위치 조회 실패');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isCommander !== true) return;

    fetchPositions();

    const channel = supabase
      .channel('map-vehicle-positions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gps_points' },
        fetchPositions
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        fetchPositions
      )
      .subscribe();

    const fallbackTimer = setInterval(fetchPositions, FALLBACK_POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(fallbackTimer);
    };
  }, [fetchPositions, isCommander]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    fetchPositions();
  }, [fetchPositions]);

  if (isCommander === null) {
    return (
      <View style={[styles.container, styles.centerBox, { paddingTop: insets.top }]}>
        <ActivityIndicator color="#A8FF5F" size="large" />
      </View>
    );
  }

  if (isCommander === false) {
    return (
      <View style={[styles.container, styles.centerBox, { paddingTop: insets.top }]}>
        <Text style={styles.accessTitle}>수송부 간부 전용</Text>
        <Text style={styles.accessDesc}>차량 위치 화면은 수송부 간부만 사용할 수 있습니다.</Text>
        <TouchableOpacity
          style={styles.roleBtn}
          onPress={() => router.replace('/role-select')}>
          <Text style={styles.roleBtnText}>역할 변경하기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const gpsCount = summaries.filter((s) => s.latitude != null).length;
  const alertCount = summaries.filter((s) => {
    const gs = getGpsStatus(s.recordedAt);
    return gs === 'stale' || gs === 'very_stale' || gs === 'no_gps' || isTripLong(s.startTime);
  }).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Text style={styles.headerEmoji}>🗺️</Text>
        </View>
        <View style={styles.headerLeft}>
          <Text style={styles.eyebrow}>관제 지도</Text>
          <Text style={styles.title}>차량 위치</Text>
          <Text style={styles.subtitle}>
            운행 {summaries.length}대 · GPS {gpsCount}대
            {alertCount > 0 ? ` · 주의 ${alertCount}대` : ''}
            {lastUpdated
              ? ` · ${lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
          <Text style={styles.refreshText}>새로고침</Text>
        </TouchableOpacity>
      </View>

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {isLoading && !html ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#A8FF5F" size="large" />
          <Text style={styles.loadingText}>차량 위치를 불러오는 중...</Text>
        </View>
      ) : (
        <>
          <VehicleMap html={html} style={styles.map} />
          {summaries.length > 0 && (
            <View style={styles.listPanel}>
              <ScrollView
                style={styles.listScroll}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}>
                {summaries.map((s) => {
                  const gpsStatus = getGpsStatus(s.recordedAt);
                  const isLong = isTripLong(s.startTime);
                  const route =
                    s.startPlace && s.endPlace
                      ? `${s.startPlace} → ${s.endPlace}`
                      : (s.startPlace ?? '-');
                  return (
                    <View key={s.tripId} style={styles.vehicleRow}>
                      <View style={styles.vehicleIcon}>
                        <Text style={styles.vehicleEmoji}>🚚</Text>
                      </View>
                      <View style={styles.vehicleRowLeft}>
                        <Text style={styles.vehicleNum} numberOfLines={1} adjustsFontSizeToFit>
                          {s.vehicleNumber}
                        </Text>
                        <Text style={styles.vehicleRoute} numberOfLines={1}>
                          {route}
                        </Text>
                        <Text style={styles.vehicleGpsTime}>
                          {s.recordedAt ? `GPS ${fmtTime(s.recordedAt)}` : 'GPS 미수신'}
                        </Text>
                      </View>
                      <View style={styles.badges}>
                        {gpsStatus === 'no_gps' && (
                          <View style={[styles.badge, styles.badgeGray]}>
                            <Text style={styles.badgeGrayText}>미수신</Text>
                          </View>
                        )}
                        {(gpsStatus === 'stale' || gpsStatus === 'very_stale') && (
                          <View
                            style={[
                              styles.badge,
                              gpsStatus === 'very_stale' ? styles.badgeRed : styles.badgeYellow,
                            ]}>
                            <Text
                              style={
                                gpsStatus === 'very_stale'
                                  ? styles.badgeRedText
                                  : styles.badgeYellowText
                              }>
                              오래됨
                            </Text>
                          </View>
                        )}
                        {isLong && (
                          <View style={[styles.badge, styles.badgeOrange]}>
                            <Text style={styles.badgeOrangeText}>장시간</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101314',
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  accessTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  accessDesc: {
    color: '#A6ADB8',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  roleBtn: {
    backgroundColor: '#A8FF5F',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  roleBtnText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderBottomColor: '#2B312E',
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: '#0A0B0A',
    borderColor: '#80FF2F',
    borderRadius: 16,
    borderWidth: 1,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  headerEmoji: {
    fontSize: 27,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  eyebrow: {
    color: '#A8FF5F',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  subtitle: {
    color: '#A6ADB8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: '#A8FF5F',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  refreshText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  errorBox: {
    backgroundColor: '#3A1C1C',
    borderRadius: 10,
    margin: 12,
    padding: 12,
  },
  errorText: {
    color: '#FF8585',
    fontSize: 13,
    fontWeight: '800',
  },
  loadingBox: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#A6ADB8',
    fontSize: 14,
    fontWeight: '800',
  },
  map: {
    flex: 1,
  },
  listPanel: {
    backgroundColor: '#1F2023',
    borderTopColor: '#2B312E',
    borderTopWidth: 1,
    maxHeight: 220,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  vehicleRow: {
    alignItems: 'center',
    borderBottomColor: '#30343A',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: 8,
  },
  vehicleRowLeft: {
    flex: 1,
    minWidth: 0,
  },
  vehicleIcon: {
    alignItems: 'center',
    backgroundColor: '#080A08',
    borderRadius: 14,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  vehicleEmoji: {
    fontSize: 23,
  },
  vehicleNum: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  vehicleRoute: {
    color: '#E6EBF2',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  vehicleGpsTime: {
    color: '#A6ADB8',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  badges: {
    alignItems: 'flex-end',
    gap: 4,
  },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeGray: {
    backgroundColor: '#2F3440',
  },
  badgeGrayText: {
    color: '#C8D1DF',
    fontSize: 11,
    fontWeight: '900',
  },
  badgeYellow: {
    backgroundColor: '#4A3A12',
  },
  badgeYellowText: {
    color: '#FFD65C',
    fontSize: 11,
    fontWeight: '900',
  },
  badgeRed: {
    backgroundColor: '#4A1C1C',
  },
  badgeRedText: {
    color: '#FF8585',
    fontSize: 11,
    fontWeight: '900',
  },
  badgeOrange: {
    backgroundColor: '#4A2C12',
  },
  badgeOrangeText: {
    color: '#FFB25C',
    fontSize: 11,
    fontWeight: '900',
  },
});
