import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Link, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppRole, clearStoredRole, getStoredRole } from '../../lib/role';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { formatDateTime, formatTripDuration, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';
import { obdBle, ObdDevice, ObdLiveData, ObdConnectionState } from '../../lib/obd-ble';

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
  const [obdState, setObdState] = useState<ObdConnectionState>('idle');
  const [obdLiveData, setObdLiveData] = useState<ObdLiveData | null>(null);
  const [obdDevices, setObdDevices] = useState<ObdDevice[]>([]);
  const [obdMessage, setObdMessage] = useState<string | null>(null);
  const [isDtcLoading, setIsDtcLoading] = useState(false);

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

  useEffect(() => {
    obdBle.setCallbacks({
      onStateChange: (state, message) => {
        setObdState(state);
        setObdMessage(message ?? null);
        if (state === 'idle' || state === 'error' || state === 'disconnected') {
          setObdDevices([]);
        }
      },
      onDeviceFound: (device) => {
        setObdDevices((prev) => (prev.find((d) => d.id === device.id) ? prev : [...prev, device]));
      },
      onData: (data) => {
        setObdLiveData(data);
      },
    });
    return () => {
      void obdBle.disconnect();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
      getStoredRole().then(setRole);
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
      <Text style={styles.title}>시스템 점검</Text>

      {/* OBD 차량 진단 패널 */}
      <View style={styles.obdPanel}>
        <View style={styles.obdPanelHeader}>
          <Text style={styles.sectionTitle}>OBD 차량 진단</Text>
          <View style={styles.obdBtnRow}>
            {(obdState === 'idle' || obdState === 'disconnected' || obdState === 'error') && (
              <TouchableOpacity style={styles.obdScanBtn} onPress={() => { setObdDevices([]); obdBle.startScan(); }}>
                <Text style={styles.obdScanBtnText}>스캔</Text>
              </TouchableOpacity>
            )}
            {obdState === 'scanning' && (
              <TouchableOpacity style={styles.obdStopBtn} onPress={() => obdBle.stopScan()}>
                <Text style={styles.obdStopBtnText}>중지</Text>
              </TouchableOpacity>
            )}
            {obdState === 'connected' && (
              <TouchableOpacity style={styles.obdStopBtn} onPress={() => { void obdBle.disconnect(); setObdLiveData(null); }}>
                <Text style={styles.obdStopBtnText}>연결 해제</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 상태 메시지 */}
        {obdMessage ? <Text style={styles.obdStatusMsg}>{obdMessage}</Text> : null}

        {/* 장치 목록 */}
        {obdDevices.length > 0 && obdState !== 'connected' && (
          <View style={styles.obdDeviceList}>
            {obdDevices.map((device) => (
              <TouchableOpacity
                key={device.id}
                style={styles.obdDeviceItem}
                onPress={() => void obdBle.connect(device.id)}
                disabled={obdState === 'connecting' || obdState === 'initializing'}>
                <Text style={styles.obdDeviceName}>{device.name}</Text>
                {device.rssi != null && <Text style={styles.obdDeviceRssi}>{device.rssi} dBm</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 연결 중 표시 */}
        {(obdState === 'connecting' || obdState === 'initializing') && (
          <View style={styles.obdConnectingRow}>
            <ActivityIndicator color="#2563EB" size="small" />
            <Text style={styles.obdConnectingText}>
              {obdState === 'initializing' ? 'ELM327 초기화 중...' : '연결 중...'}
            </Text>
          </View>
        )}

        {/* 실시간 진단 데이터 */}
        {obdLiveData && obdState === 'connected' && (
          <>
            <View style={styles.obdDataGrid}>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>배터리</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.batteryVoltage ?? '-'} V</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>연료</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.fuelLevelPercent ?? '-'} %</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>냉각수</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.coolantTempC ?? '-'} °C</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>엔진 부하</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.engineLoadPercent ?? '-'} %</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>스로틀</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.throttlePercent ?? '-'} %</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>흡기 온도</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.intakeAirTempC ?? '-'} °C</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>RPM</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.rpm?.toLocaleString() ?? '-'}</Text>
              </View>
              <View style={styles.obdDataItem}>
                <Text style={styles.obdDataLabel}>차속</Text>
                <Text style={styles.obdDataValue}>{obdLiveData.speedKmh ?? '-'} km/h</Text>
              </View>
            </View>

            {/* DTC 결함코드 */}
            <View style={styles.obdDtcRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.obdDtcLabel}>결함코드 (DTC)</Text>
                {obdLiveData.dtcCodes.length === 0 ? (
                  <Text style={styles.obdDtcNone}>이상 없음</Text>
                ) : (
                  <Text style={styles.obdDtcCodes}>{obdLiveData.dtcCodes.join(', ')}</Text>
                )}
              </View>
              <TouchableOpacity
                style={[styles.obdDtcBtn, isDtcLoading && styles.obdDtcBtnDisabled]}
                onPress={async () => { setIsDtcLoading(true); await obdBle.readDtcCodes(); setIsDtcLoading(false); }}
                disabled={isDtcLoading}>
                {isDtcLoading ? <ActivityIndicator color="#2563EB" size="small" /> : <Text style={styles.obdDtcBtnText}>읽기</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* 타이어 압력 안내 */}
        <View style={styles.obdNotSupportedRow}>
          <Text style={styles.obdNotSupportedLabel}>타이어 압력 (TPMS)</Text>
          <Text style={styles.obdNotSupportedValue}>표준 OBD-II 미지원</Text>
        </View>
        <Text style={styles.obdTpmsHint}>TPMS는 제조사 독점 CAN 채널로 ELM327 어댑터로는 읽을 수 없습니다.</Text>
      </View>

      <View style={[styles.statusPanel, status === 'error' && styles.errorPanel]}>
        <View>
          <Text style={styles.statusLabel}>상태</Text>
          <Text style={[styles.statusValue, status === 'error' && styles.errorValue]}>
            {status === 'checking' ? '확인 중' : status === 'ok' ? '정상' : '확인 필요'}
          </Text>
        </View>
        {status === 'checking' && <ActivityIndicator color="#2563EB" />}
      </View>

      {message && (
        <View style={status === 'error' ? styles.errorBox : styles.noticeBox}>
          <Text style={status === 'error' ? styles.errorText : styles.noticeText}>{message}</Text>
        </View>
      )}

      <View style={styles.grid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>차량</Text>
          <Text style={styles.metricValue}>{summary.vehicles}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>운행 중</Text>
          <Text style={[styles.metricValue, summary.activeTrips > 1 && styles.warningValue]}>
            {summary.activeTrips}
          </Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>완료</Text>
          <Text style={styles.metricValue}>{summary.completedTrips}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>무효</Text>
          <Text style={styles.metricValue}>{summary.canceledTrips}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>GPS</Text>
          <Text style={styles.metricValue}>{summary.gpsPoints}</Text>
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
          <Text style={styles.infoLabel}>최근 GPS</Text>
          <Text style={styles.infoValue}>{formatDateTime(summary.latestGpsAt)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>GPS 경과</Text>
          <Text style={[styles.infoValue, isLatestGpsStale && styles.warningInfoValue]}>
            {latestGpsAgeHours === null ? '-' : `${latestGpsAgeHours}시간 전`}
          </Text>
        </View>
      </View>

      <View style={styles.infoPanel}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>사용자 역할</Text>
          <Text style={styles.infoValue}>
            {role === 'commander' ? '수송부 간부' : role === 'driver' ? '운전자' : '-'}
          </Text>
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
            await clearStoredRole();
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
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  statusPanel: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 14,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  errorPanel: {
    borderColor: '#FECACA',
  },
  statusLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  statusValue: {
    color: '#059669',
    fontSize: 22,
    fontWeight: '700',
  },
  errorValue: {
    color: '#DC2626',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  metricCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
  },
  metricValue: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '700',
  },
  warningValue: {
    color: '#D97706',
  },
  infoPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionHint: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '400',
    marginBottom: 10,
  },
  activeTripRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  staleTripRow: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  duplicatedTripRow: {
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
  },
  activeTripTextBox: {
    flex: 1,
    marginRight: 12,
  },
  activeTripTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
  },
  activeTripMeta: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 3,
  },
  staleTripMeta: {
    color: '#DC2626',
    fontWeight: '600',
  },
  detailBtn: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
  },
  detailText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
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
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  infoValue: {
    color: '#0F172A',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 14,
    textAlign: 'right',
  },
  warningInfoValue: {
    color: '#D97706',
  },
  noticeBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#1D4ED8',
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
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '500',
  },
  warningBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  warningText: {
    color: '#B45309',
    fontSize: 14,
    fontWeight: '500',
  },
  changePinBtn: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
  },
  changePinText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  changeRoleBtn: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 44,
  },
  changeRoleText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  reloadBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  reloadText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  // OBD 진단 패널
  obdPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  obdPanelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  obdBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  obdScanBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  obdScanBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  obdStopBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  obdStopBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  obdStatusMsg: {
    color: '#64748B',
    fontSize: 13,
    marginBottom: 10,
  },
  obdDeviceList: {
    gap: 8,
    marginBottom: 12,
  },
  obdDeviceItem: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  obdDeviceName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  obdDeviceRssi: {
    color: '#94A3B8',
    fontSize: 12,
  },
  obdConnectingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  obdConnectingText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '500',
  },
  obdDataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  obdDataItem: {
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '23%',
    flexGrow: 1,
    paddingVertical: 10,
  },
  obdDataLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 4,
  },
  obdDataValue: {
    color: '#059669',
    fontSize: 14,
    fontWeight: '700',
  },
  obdDtcRow: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  obdDtcLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  obdDtcNone: {
    color: '#059669',
    fontSize: 14,
    fontWeight: '600',
  },
  obdDtcCodes: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
  obdDtcBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 52,
    alignItems: 'center',
  },
  obdDtcBtnDisabled: {
    opacity: 0.5,
  },
  obdDtcBtnText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  obdNotSupportedRow: {
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  obdNotSupportedLabel: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
  },
  obdNotSupportedValue: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '500',
  },
  obdTpmsHint: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 16,
  },
});
