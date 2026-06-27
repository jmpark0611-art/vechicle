import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Link, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccessCounterStats, getAppAccessCounter } from '../../lib/access-counter';
import { getStoredPin } from '../../lib/commander-pin';
import { getGpsQueueSize } from '../../lib/gps-queue';
import { AppRole, clearStoredRole, getStoredRole } from '../../lib/role';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { formatDateTime, formatTripDuration, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type HealthStatus = 'checking' | 'ok' | 'error';
const ACTIVE_TRIP_DETAIL_LIMIT = 10;

type HealthSummary = {
  vehicles: number;
  activeTrips: number;
  completedTrips: number;
  canceledTrips: number;
  gpsPoints: number;
  latestGpsAt: string | null;
};

type ActiveTrip = {
  id: string;
  vehicle_id: string | null;
  start_time: string | null;
};

type Vehicle = {
  id: string;
  vehicle_number: string;
};

function getSupabaseSourceText() {
  if (supabaseConfig.source === 'env') {
    return '환경변수';
  }

  if (supabaseConfig.source === 'fallback-invalid-env') {
    return '환경변수 오류 fallback';
  }

  return 'fallback 개발값';
}

function getSupabaseWarningText() {
  if (supabaseConfig.source === 'fallback-invalid-env') {
    return 'Supabase URL 환경변수가 올바른 http/https URL이 아니어서 fallback 개발값으로 연결했습니다. .env.local의 EXPO_PUBLIC_SUPABASE_URL을 확인해 주세요.';
  }

  return '현재 Supabase 설정은 fallback 개발값입니다. 운영 또는 다른 PC에서는 .env.local에 EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_ANON_KEY를 설정해 주세요.';
}

function getAgeHours(value: string | null) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - time) / 3600000));
}

export default function CheckScreen() {
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version ?? '-';
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? '-';
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [summary, setSummary] = useState<HealthSummary>({
    vehicles: 0,
    activeTrips: 0,
    completedTrips: 0,
    canceledTrips: 0,
    gpsPoints: 0,
    latestGpsAt: null,
  });
  const [activeTrips, setActiveTrips] = useState<ActiveTrip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [gpsQueueSize, setGpsQueueSize] = useState(0);
  const [pinIsSet, setPinIsSet] = useState<boolean | null>(null);
  const [accessCounter, setAccessCounter] = useState<AccessCounterStats | null>(null);

  const loadStatus = useCallback(async (refreshing = false) => {
    setStatus('checking');
    setMessage(null);

    if (refreshing) {
      setIsRefreshing(true);
    }

    try {
      const [
        vehiclesResult,
        activeTripsResult,
        completedTripsResult,
        canceledTripsResult,
        gpsCountResult,
        latestGpsResult,
        activeTripListResult,
        vehicleListResult,
      ] = await Promise.all([
          withTimeout(
            supabase.from('vehicles').select('id', { count: 'exact', head: true }),
            '차량 점검'
          ),
          withTimeout(
            supabase
              .from('trips')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'in_progress'),
            '진행 운행 점검'
          ),
          withTimeout(
            supabase
              .from('trips')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'completed'),
            '완료 운행 점검'
          ),
          withTimeout(
            supabase
              .from('trips')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'canceled'),
            '무효 운행 점검'
          ),
          withTimeout(
            supabase.from('gps_points').select('trip_id', { count: 'exact', head: true }),
            'GPS 점검'
          ),
          withTimeout(
            supabase.from('gps_points').select('recorded_at').order('recorded_at', {
              ascending: false,
            }).limit(1).maybeSingle(),
            '최근 GPS 점검'
          ),
          withTimeout(
            supabase
              .from('trips')
              .select('id, vehicle_id, start_time')
              .eq('status', 'in_progress')
              .order('start_time', { ascending: false })
              .limit(ACTIVE_TRIP_DETAIL_LIMIT),
            '진행 운행 목록'
          ),
          withTimeout(supabase.from('vehicles').select('id, vehicle_number'), '차량 목록'),
        ]);

      const firstError =
        vehiclesResult.error ??
        activeTripsResult.error ??
        completedTripsResult.error ??
        canceledTripsResult.error ??
        gpsCountResult.error ??
        latestGpsResult.error ??
        activeTripListResult.error ??
        vehicleListResult.error;

      if (firstError) {
        setStatus('error');
        setMessage(formatDbError(firstError, '점검 중 오류가 발생했습니다.'));
        return;
      }

      setSummary({
        vehicles: vehiclesResult.count ?? 0,
        activeTrips: activeTripsResult.count ?? 0,
        completedTrips: completedTripsResult.count ?? 0,
        canceledTrips: canceledTripsResult.count ?? 0,
        gpsPoints: gpsCountResult.count ?? 0,
        latestGpsAt: latestGpsResult.data?.recorded_at ?? null,
      });
      setActiveTrips((activeTripListResult.data ?? []) as ActiveTrip[]);
      setVehicles((vehicleListResult.data ?? []) as Vehicle[]);
      setStatus('ok');
      setMessage('Supabase 연결과 기본 테이블 조회가 정상입니다.');
    } catch (error) {
      setStatus('error');
      setActiveTrips([]);
      setVehicles([]);
      setMessage(formatDbError(error, '점검 중 오류가 발생했습니다.'));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const staleActiveTripCount = activeTrips.filter((trip) => isStaleActiveTrip(trip.start_time)).length;
  const latestGpsAgeHours = getAgeHours(summary.latestGpsAt);
  const isLatestGpsStale = summary.gpsPoints > 0 && latestGpsAgeHours !== null && latestGpsAgeHours >= 24;
  const hasTripsWithoutGps =
    summary.gpsPoints === 0 &&
    summary.activeTrips + summary.completedTrips + summary.canceledTrips > 0;
  const duplicatedActiveTrips = useMemo(() => {
    const counts = new Map<string, number>();

    activeTrips.forEach((trip) => {
      if (!trip.vehicle_id) {
        return;
      }

      counts.set(trip.vehicle_id, (counts.get(trip.vehicle_id) ?? 0) + 1);
    });

    return activeTrips.filter((trip) => {
      return trip.vehicle_id ? (counts.get(trip.vehicle_id) ?? 0) > 1 : false;
    });
  }, [activeTrips]);

  const getVehicleNumber = useCallback(
    (vehicleId: string | null) => {
      return vehicles.find((vehicle) => vehicle.id === vehicleId)?.vehicle_number ?? '차량 정보 없음';
    },
    [vehicles]
  );

  useFocusEffect(
    useCallback(() => {
      loadStatus();
      getStoredRole().then((r) => {
        setRole(r);
        if (r === 'commander') {
          getStoredPin().then((pin) => setPinIsSet(pin !== null));
        } else {
          setPinIsSet(null);
        }
      });
      getGpsQueueSize().then(setGpsQueueSize);
      getAppAccessCounter().then(setAccessCounter);
    }, [loadStatus])
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom + 96, 112),
          paddingTop: Math.max(insets.top + 24, 56),
        },
      ]}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={() => loadStatus(true)} />
      }>
      <View style={[styles.statusPanel, status === 'error' && styles.errorPanel]}>
        <View style={styles.statusIcon}>
          <Text style={styles.statusEmoji}>{status === 'error' ? '🚨' : status === 'checking' ? '🔍' : '✅'}</Text>
        </View>
        <View style={styles.statusTextBox}>
          <Text style={styles.statusLabel}>시스템 점검</Text>
          <Text style={[styles.statusValue, status === 'error' && styles.errorValue]}>
            {status === 'checking' ? '확인 중' : status === 'ok' ? '정상' : '확인 필요'}
          </Text>
          <Text style={styles.statusSubText}>Supabase, GPS, 권한, 큐 상태를 확인합니다.</Text>
        </View>
        {status === 'checking' && <ActivityIndicator color="#A8FF5F" />}
      </View>

      {message && (
        <View style={status === 'error' ? styles.errorBox : styles.noticeBox}>
          <Text style={status === 'error' ? styles.errorText : styles.noticeText}>{message}</Text>
        </View>
      )}

      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricEmoji}>🚗</Text>
          <View>
            <Text style={styles.metricLabel}>차량</Text>
            <Text style={styles.metricValue}>{summary.vehicles}</Text>
          </View>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricEmoji}>⚡</Text>
          <View>
            <Text style={styles.metricLabel}>운행 중</Text>
            <Text style={[styles.metricValue, summary.activeTrips > 1 && styles.warningValue]}>
              {summary.activeTrips}
            </Text>
          </View>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricEmoji}>✅</Text>
          <View>
            <Text style={styles.metricLabel}>완료</Text>
            <Text style={styles.metricValue}>{summary.completedTrips}</Text>
          </View>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricEmoji}>🛑</Text>
          <View>
            <Text style={styles.metricLabel}>무효</Text>
            <Text style={styles.metricValue}>{summary.canceledTrips}</Text>
          </View>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricEmoji}>📍</Text>
          <View>
            <Text style={styles.metricLabel}>GPS</Text>
            <Text style={styles.metricValue}>{summary.gpsPoints}</Text>
          </View>
        </View>
      </View>

      {summary.activeTrips > 1 && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            진행 중 운행이 여러 건입니다. 운행 탭은 최신 운행을 복구하므로, 이전 미종료 운행은
            기록 탭에서 확인해 주세요.
          </Text>
        </View>
      )}

      {duplicatedActiveTrips.length > 0 && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            같은 차량에 진행 중 운행이 겹친 기록이 {duplicatedActiveTrips.length}건 있습니다.
            아래 상세 화면에서 정상 운행만 남기고 나머지는 무효 처리해 주세요.
          </Text>
        </View>
      )}

      {staleActiveTripCount > 0 && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>8시간 이상 종료되지 않은 운행이 {staleActiveTripCount}건 있습니다. 운행 탭에서 복구 후 종료 여부를 확인해 주세요.</Text>
        </View>
      )}

      {isLatestGpsStale && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            최근 GPS가 {latestGpsAgeHours}시간 전 기록입니다. 최근 운행이 있었는데 GPS가 갱신되지 않았다면 위치 권한과 네트워크 상태를 확인해 주세요.
          </Text>
        </View>
      )}

      {hasTripsWithoutGps && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            운행 기록은 있지만 GPS 포인트가 없습니다. 위치 권한, gps_points 테이블, Supabase RLS/insert 정책을 확인해 주세요.
          </Text>
        </View>
      )}

      {activeTrips.length > 0 && (
        <View style={styles.infoPanel}>
          <Text style={styles.sectionTitle}>진행 중 운행</Text>
          {summary.activeTrips > activeTrips.length && (
            <Text style={styles.sectionHint}>
              최근 진행 운행 표시 {activeTrips.length}건 / 전체 {summary.activeTrips}건
            </Text>
          )}
          {activeTrips.map((trip) => {
            const isStale = isStaleActiveTrip(trip.start_time);
            const isDuplicated =
              duplicatedActiveTrips.find((duplicatedTrip) => duplicatedTrip.id === trip.id) != null;

            return (
              <View
                key={trip.id}
                style={[
                  styles.activeTripRow,
                  isStale && styles.staleTripRow,
                  isDuplicated && styles.duplicatedTripRow,
                ]}>
              <View style={styles.activeTripTextBox}>
                <Text style={styles.activeTripTitle}>{getVehicleNumber(trip.vehicle_id)}</Text>
                <Text style={styles.activeTripMeta}>출발 {formatDateTime(trip.start_time)}</Text>
                <Text style={[styles.activeTripMeta, isStale && styles.staleTripMeta]}>
                  {isDuplicated ? '중복 진행 중 · ' : ''}
                  {formatTripDuration(trip.start_time, null)}
                </Text>
              </View>
              <Link
                href={{
                  pathname: '/trips/[id]',
                  params: { id: trip.id },
                }}
                asChild>
                <TouchableOpacity style={styles.detailBtn}>
                  <Text style={styles.detailText}>상세</Text>
                </TouchableOpacity>
              </Link>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.infoPanel}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>앱 버전</Text>
          <Text style={styles.infoValue}>{appVersion}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Expo SDK</Text>
          <Text style={styles.infoValue}>{sdkVersion}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Supabase</Text>
          <Text style={styles.infoValue}>{supabaseConfig.urlHost}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>설정 출처</Text>
          <Text style={[styles.infoValue, supabaseConfig.isUsingFallback && styles.warningInfoValue]}>
            {getSupabaseSourceText()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>최근 GPS</Text>
          <Text style={styles.infoValue}>{formatDateTime(summary.latestGpsAt)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>GPS 경과</Text>
          <Text style={[styles.infoValue, isLatestGpsStale && styles.warningInfoValue]}>
            {latestGpsAgeHours === null ? '-' : `${latestGpsAgeHours}시간 전`}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>PC 실행</Text>
          <Text style={styles.infoValue}>npm.cmd run start:offline</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>휴대폰 테스트</Text>
          <Text style={styles.infoValue}>npm.cmd run start:lan</Text>
        </View>
      </View>

      {supabaseConfig.isUsingFallback && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>{getSupabaseWarningText()}</Text>
        </View>
      )}

      <View style={styles.infoPanel}>
        <Text style={styles.sectionTitle}>실기기 확인</Text>
        <Text style={styles.checkText}>1. PC와 Android 휴대폰을 같은 Wi-Fi에 연결</Text>
        <Text style={styles.checkText}>2. npm.cmd run start:lan 실행 후 Expo Go에서 QR 스캔</Text>
        <Text style={styles.checkText}>3. 위치 권한 허용 후 출발, GPS 수집, 종료 확인</Text>
      </View>

      <View style={styles.infoPanel}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>사용자 역할</Text>
          <Text style={styles.infoValue}>
            {role === 'commander' ? '수송부 간부' : role === 'driver' ? '운전자' : '-'}
          </Text>
        </View>
        {role === 'commander' && pinIsSet !== null && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>PIN 잠금</Text>
            <Text style={[styles.infoValue, !pinIsSet && styles.warningInfoValue]}>
              {pinIsSet ? '설정됨' : '미설정'}
            </Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>GPS 대기 큐</Text>
          <Text style={[styles.infoValue, gpsQueueSize > 0 && styles.warningInfoValue]}>
            {gpsQueueSize > 0 ? `${gpsQueueSize}건 미전송` : '없음'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>누적 접속</Text>
          <Text style={styles.infoValue}>{accessCounter ? `${accessCounter.totalCount}회` : '-'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>접속 집계</Text>
          <Text style={styles.infoValue}>{formatDateTime(accessCounter?.updatedAt ?? null)}</Text>
        </View>
        {role === 'commander' && (
          <TouchableOpacity
            style={styles.changePinBtn}
            onPress={() => router.push({ pathname: '/commander-pin', params: { change: '1' } })}>
            <Text style={styles.changePinText}>PIN 변경</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.changeRoleBtn}
          onPress={async () => {
            try {
              await clearStoredRole();
            } catch {
              Alert.alert('오류', '역할 초기화에 실패했습니다. 다시 시도해 주세요.');
              return;
            }
            router.replace('/role-select');
          }}>
          <Text style={styles.changeRoleText}>역할 변경</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.reloadBtn} onPress={() => loadStatus(true)} disabled={isRefreshing}>
        <Text style={styles.reloadText}>{isRefreshing ? '확인 중...' : '다시 점검'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#101314',
    padding: 18,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  statusPanel: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 14,
    padding: 16,
  },
  errorPanel: {
    borderColor: '#633030',
  },
  statusIcon: {
    alignItems: 'center',
    backgroundColor: '#0A0B0A',
    borderColor: '#80FF2F',
    borderRadius: 18,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  statusEmoji: {
    fontSize: 30,
  },
  statusTextBox: {
    flex: 1,
    minWidth: 0,
  },
  statusLabel: {
    color: '#A8FF5F',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  statusValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  statusSubText: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 4,
  },
  errorValue: {
    color: '#FF8585',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  metricCard: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  metricEmoji: {
    fontSize: 24,
  },
  metricLabel: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
  },
  warningValue: {
    color: '#FFD65C',
  },
  infoPanel: {
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 12,
  },
  sectionHint: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  activeTripRow: {
    alignItems: 'center',
    borderBottomColor: '#30343A',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  staleTripRow: {
    backgroundColor: '#3A1C1C',
    borderRadius: 10,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  duplicatedTripRow: {
    borderColor: '#633030',
    borderWidth: 1,
    borderRadius: 10,
  },
  activeTripTextBox: {
    flex: 1,
    marginRight: 12,
  },
  activeTripTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  activeTripMeta: {
    color: '#A6ADB8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  staleTripMeta: {
    color: '#FF8585',
    fontWeight: '900',
  },
  detailBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  detailText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '900',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 34,
  },
  infoLabel: {
    color: '#A6ADB8',
    fontSize: 14,
    fontWeight: '800',
  },
  infoValue: {
    color: '#E6EBF2',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 14,
    textAlign: 'right',
  },
  warningInfoValue: {
    color: '#FFD65C',
  },
  checkText: {
    color: '#E6EBF2',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 6,
  },
  noticeBox: {
    backgroundColor: '#1F2023',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#A8FF5F',
    fontSize: 14,
    fontWeight: '800',
  },
  errorBox: {
    backgroundColor: '#3A1C1C',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  errorText: {
    color: '#FF8585',
    fontSize: 14,
    fontWeight: '800',
  },
  warningBox: {
    backgroundColor: '#4A3A12',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  warningText: {
    color: '#FFD65C',
    fontSize: 14,
    fontWeight: '800',
  },
  changePinBtn: {
    alignItems: 'center',
    backgroundColor: '#2F3440',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
  },
  changePinText: {
    color: '#E6EBF2',
    fontSize: 14,
    fontWeight: '900',
  },
  changeRoleBtn: {
    alignItems: 'center',
    backgroundColor: '#2F3440',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 44,
  },
  changeRoleText: {
    color: '#E6EBF2',
    fontSize: 14,
    fontWeight: '900',
  },
  reloadBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    shadowColor: '#A8FF5F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  reloadText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
  },
});
