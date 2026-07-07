import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import {
  formatDateTime,
  formatTripDuration,
  getTripElapsedMinutes,
  getTripStatusText,
  isStaleActiveTrip,
} from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type Vehicle = {
  id: string;
  vehicle_number: string;
  equipment_name: string | null;
  equipment_number: string | null;
};

type Trip = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  purpose: string | null;
  operator_name: string | null;
  operator_rank: string | null;
  user_name: string | null;
  user_rank: string | null;
  daily_km: number | null;
  total_km: number | null;
  fuel_station: string | null;
  fuel_added_liters: number | null;
  start_odometer: number | null;
  end_odometer: number | null;
};

type GpsPoint = {
  trip_id: string;
  recorded_at: string | null;
};

type GpsSummary = {
  count: number;
  latestRecordedAt: string | null;
};

type HistoryFilter = 'all' | 'running' | 'completed' | 'canceled';
const HISTORY_TRIP_LIMIT = 30;

type LoadHistoryOptions = {
  limit?: number;
  loadingMore?: boolean;
  refreshing?: boolean;
};

function getTripTime(value: string | null) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}


function formatMinutes(minutes: number | null) {
  if (minutes === null) {
    return '-';
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}시간 ${restMinutes}분`;
  }

  return `${restMinutes}분`;
}

function generatePvHtml(
  selectedVehicle: Vehicle | null,
  pvTrips: Trip[],
  vehicleMap: Map<string, string>,
  startDate: string,
  endDate: string
): string {
  const vehicleLabel = selectedVehicle
    ? `${selectedVehicle.vehicle_number}${selectedVehicle.equipment_name ? ` (${selectedVehicle.equipment_name}${selectedVehicle.equipment_number ? ' ' + selectedVehicle.equipment_number : ''})` : ''}`
    : '전 차량';

  const rows = pvTrips
    .map((trip, idx) => {
      const vNum = (trip.vehicle_id && vehicleMap.get(trip.vehicle_id)) || '-';
      const startDt = trip.start_time ? new Date(trip.start_time) : null;
      const endDt = trip.end_time ? new Date(trip.end_time) : null;
      const dateStr = startDt
        ? startDt.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
        : '-';
      const startTimeStr = startDt
        ? startDt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '-';
      const endTimeStr = endDt
        ? endDt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '-';
      const fuelStr = [trip.fuel_station, trip.fuel_added_liters != null ? `${trip.fuel_added_liters}L` : null]
        .filter(Boolean)
        .join(' ');
      return `<tr>
        <td>${idx + 1}</td><td>${dateStr}</td><td>${vNum}</td>
        <td>${[trip.operator_rank, trip.operator_name].filter(Boolean).join(' ') || '-'}</td><td>${[trip.user_rank, trip.user_name].filter(Boolean).join(' ') || '-'}</td>
        <td>${trip.purpose ?? '-'}</td><td>${trip.start_place ?? '-'}</td><td>${trip.end_place ?? '-'}</td>
        <td>${startTimeStr}</td><td>${endTimeStr}</td>
        <td>${trip.daily_km != null ? trip.daily_km : '-'}</td><td>${fuelStr || '-'}</td><td></td>
      </tr>`;
    })
    .join('\n');

  const emptyRow =
    pvTrips.length === 0
      ? '<tr><td colspan="13" style="height:48px;color:#888;text-align:center">해당 기간 운행 기록 없음</td></tr>'
      : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>장비운행증</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10pt;color:#000;background:#fff}
.wrap{padding:24px 20px}
h1{text-align:center;font-size:17pt;font-weight:900;letter-spacing:10px;margin-bottom:12px}
.meta{display:flex;justify-content:space-between;font-size:9.5pt;margin-bottom:14px;border-bottom:1px solid #000;padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th,td{border:1px solid #000;padding:4px 3px;text-align:center;vertical-align:middle;word-break:keep-all}
th{background:#e0e0e0;font-weight:700}
.sig-row{display:flex;gap:32px;justify-content:flex-end;margin-top:20px}
.sig-box{border:1px solid #000;width:100px;text-align:center;padding:6px 0}
.sig-label{font-size:9pt;margin-bottom:32px}
.sig-line{font-size:9pt}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="wrap">
<h1>장 비 운 행 증</h1>
<div class="meta">
  <span>장비: ${vehicleLabel}</span>
  <span>기간: ${startDate} ~ ${endDate}</span>
  <span>계: ${pvTrips.length}건</span>
</div>
<table>
<thead>
<tr>
  <th>일련</th><th>일자</th><th>차량번호</th><th>운용자</th><th>사용자</th>
  <th>운행목적</th><th>출발지</th><th>목적지</th><th>출발</th><th>도착</th>
  <th>일일km</th><th>유류</th><th>비고</th>
</tr>
</thead>
<tbody>
${rows}${emptyRow}
</tbody>
</table>
<div class="sig-row">
  <div class="sig-box"><p class="sig-label">운전자</p><p class="sig-line">서 명</p></div>
  <div class="sig-box"><p class="sig-label">확인자</p><p class="sig-line">서 명</p></div>
</div>
</div>
<script>window.onload=function(){window.print()}</script>
</body>
</html>`;
}

export default function TripHistoryScreen() {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [gpsSummaryByTripId, setGpsSummaryByTripId] = useState<Map<string, GpsSummary>>(new Map());
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [historyLimit, setHistoryLimit] = useState(HISTORY_TRIP_LIMIT);
  const [hasMoreTrips, setHasMoreTrips] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pvModalVisible, setPvModalVisible] = useState(false);
  const [pvStartDate, setPvStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [pvEndDate, setPvEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const vehicleMap = useMemo(() => {
    return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicle_number]));
  }, [vehicles]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId]
  );

  const pvTrips = useMemo(() => {
    const start = pvStartDate ? new Date(pvStartDate + 'T00:00:00') : null;
    const end = pvEndDate ? new Date(pvEndDate + 'T23:59:59') : null;
    return trips.filter((trip) => {
      if (selectedVehicleId && trip.vehicle_id !== selectedVehicleId) return false;
      const t = trip.start_time ? new Date(trip.start_time) : null;
      if (!t) return false;
      if (start && t < start) return false;
      if (end && t > end) return false;
      return true;
    });
  }, [trips, selectedVehicleId, pvStartDate, pvEndDate]);

  const runningCount = useMemo(() => {
    return trips.filter((trip) => trip.status === 'in_progress').length;
  }, [trips]);

  const completedCount = useMemo(() => {
    return trips.filter((trip) => trip.status === 'completed').length;
  }, [trips]);

  const canceledCount = useMemo(() => {
    return trips.filter((trip) => trip.status === 'canceled').length;
  }, [trips]);

  const staleRunningCount = useMemo(() => {
    return trips.filter((trip) => trip.status === 'in_progress' && isStaleActiveTrip(trip.start_time)).length;
  }, [trips]);

  const filteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      const matchesStatus =
        filter === 'all' ||
        (filter === 'running' && trip.status === 'in_progress') ||
        (filter === 'completed' && trip.status === 'completed') ||
        (filter === 'canceled' && trip.status === 'canceled');

      if (!matchesStatus) {
        return false;
      }

      if (selectedVehicleId && trip.vehicle_id !== selectedVehicleId) {
        return false;
      }

      return true;
    });
  }, [filter, selectedVehicleId, trips]);

  const handlePrintPv = useCallback(() => {
    if (Platform.OS !== 'web') {
      Alert.alert('출력 안내', '장비운행증 출력은 웹 브라우저에서만 지원됩니다.');
      setPvModalVisible(false);
      return;
    }
    const html = generatePvHtml(selectedVehicle, pvTrips, vehicleMap, pvStartDate, pvEndDate);
    const webGlobal = globalThis as typeof globalThis & { open: (url: string, target: string) => Window | null };
    const win = webGlobal.open('', '_blank');
    if (!win) {
      Alert.alert('팝업 차단됨', '브라우저 팝업을 허용한 뒤 다시 시도해 주세요.');
      return;
    }
    win.document.write(html);
    win.document.close();
    setPvModalVisible(false);
  }, [selectedVehicle, pvTrips, vehicleMap, pvStartDate, pvEndDate]);

  const filteredSummary = useMemo(() => {
    const completedTrips = filteredTrips.filter((trip) => trip.status === 'completed');
    const completedWithoutGps = completedTrips.filter((trip) => {
      return (gpsSummaryByTripId.get(trip.id)?.count ?? 0) === 0;
    }).length;
    const completedDurations = completedTrips
      .map((trip) => getTripElapsedMinutes(trip.start_time, trip.end_time))
      .filter((minutes): minutes is number => minutes !== null);
    const totalGpsPoints = filteredTrips.reduce((sum, trip) => {
      return sum + (gpsSummaryByTripId.get(trip.id)?.count ?? 0);
    }, 0);
    const averageDuration =
      completedDurations.length > 0
        ? Math.round(
            completedDurations.reduce((sum, minutes) => sum + minutes, 0) / completedDurations.length
          )
        : null;

    return {
      active: filteredTrips.filter((trip) => trip.status === 'in_progress').length,
      averageDuration,
      completed: completedTrips.length,
      completedWithoutGps,
      gpsPoints: totalGpsPoints,
      total: filteredTrips.length,
    };
  }, [filteredTrips, gpsSummaryByTripId]);

  const groupedTrips = useMemo(() => {
    const groups: { date: string; trips: Trip[] }[] = [];
    const dateMap = new Map<string, Trip[]>();

    for (const trip of filteredTrips) {
      const dateKey = trip.start_time
        ? new Date(trip.start_time).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '날짜 미상';

      if (!dateMap.has(dateKey)) {
        const group: Trip[] = [];
        dateMap.set(dateKey, group);
        groups.push({ date: dateKey, trips: group });
      }

      dateMap.get(dateKey)!.push(trip);
    }

    return groups;
  }, [filteredTrips]);

  const loadHistory = useCallback(async (options: LoadHistoryOptions = {}) => {
    const nextLimit = options.limit ?? HISTORY_TRIP_LIMIT;

    if (options.refreshing) {
      setIsRefreshing(true);
    } else if (options.loadingMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    setErrorMessage(null);

    try {
      const [tripsResult, vehiclesResult] = await Promise.all([
        withTimeout(
          supabase
            .from('trips')
            .select('id, vehicle_id, start_place, end_place, start_time, end_time, status, purpose, operator_name, operator_rank, user_name, user_rank, daily_km, total_km, fuel_station, fuel_added_liters, start_odometer, end_odometer')
            .order('start_time', { ascending: false })
            .range(0, nextLimit),
          '운행 기록'
        ),
        withTimeout(supabase.from('vehicles').select('id, vehicle_number, equipment_name, equipment_number'), '차량 목록'),
      ]);

      const loadedTrips = tripsResult.error ? [] : ((tripsResult.data ?? []) as Trip[]);
      const nextTrips = loadedTrips.slice(0, nextLimit);

      if (tripsResult.error) {
        setErrorMessage(formatDbError(tripsResult.error, '운행 기록을 불러오는 중 오류가 발생했습니다.'));
        setTrips([]);
        setHasMoreTrips(false);
      } else {
        setTrips(nextTrips);
        setHasMoreTrips(loadedTrips.length > nextLimit);
      }

      if (vehiclesResult.error) {
        setErrorMessage((current) => current ?? formatDbError(vehiclesResult.error));
        setVehicles([]);
      } else {
        setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
      }

      if (nextTrips.length > 0) {
        const tripIds = nextTrips.map((trip) => trip.id);
        const gpsResult = await withTimeout(
          supabase.from('gps_points').select('trip_id, recorded_at').in('trip_id', tripIds),
          'GPS 기록'
        );

        if (gpsResult.error) {
          setErrorMessage((current) => current ?? formatDbError(gpsResult.error));
          setGpsSummaryByTripId(new Map());
        } else {
          const nextSummary = new Map<string, GpsSummary>();

          ((gpsResult.data ?? []) as GpsPoint[]).forEach((point) => {
            const current = nextSummary.get(point.trip_id) ?? {
              count: 0,
              latestRecordedAt: null,
            };
            const latestRecordedAt =
              current.latestRecordedAt && point.recorded_at
                ? new Date(current.latestRecordedAt) > new Date(point.recorded_at)
                  ? current.latestRecordedAt
                  : point.recorded_at
                : point.recorded_at ?? current.latestRecordedAt;

            nextSummary.set(point.trip_id, {
              count: current.count + 1,
              latestRecordedAt,
            });
          });

          setGpsSummaryByTripId(nextSummary);
        }
      } else {
        setGpsSummaryByTripId(new Map());
      }
    } catch (error) {
      setTrips([]);
      setVehicles([]);
      setGpsSummaryByTripId(new Map());
      setHasMoreTrips(false);
      setErrorMessage(
        formatDbError(error, '운행 기록을 불러오는 중 오류가 발생했습니다.')
      );
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setHistoryLimit(HISTORY_TRIP_LIMIT);
    loadHistory({ limit: HISTORY_TRIP_LIMIT, refreshing: true });
  }, [loadHistory]);

  const handleLoadMore = useCallback(() => {
    const nextLimit = historyLimit + HISTORY_TRIP_LIMIT;
    setHistoryLimit(nextLimit);
    loadHistory({ limit: nextLimit, loadingMore: true });
  }, [historyLimit, loadHistory]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
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
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
      }>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.headerMeta}>수송부</Text>
          <Text style={styles.title}>운행 기록</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="장비운행증 출력"
          style={styles.headerCsvBtn}
          onPress={() => setPvModalVisible(true)}>
          <Text style={styles.headerCsvText}>장비운행증 내보내기</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.viewToggleBar}>
        <TouchableOpacity
          style={[styles.viewToggleBtn, viewMode === 'card' && styles.viewToggleBtnActive]}
          onPress={() => setViewMode('card')}>
          <Text style={[styles.viewToggleText, viewMode === 'card' && styles.viewToggleTextActive]}>▭ 카드형</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
          onPress={() => setViewMode('list')}>
          <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>☰ 리스트형</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.demoFilterBar}>
        <TouchableOpacity
          style={[styles.demoFilterBtn, filter === 'all' && styles.demoFilterBtnActive]}
          onPress={() => setFilter('all')}>
          <Text style={[styles.demoFilterText, filter === 'all' && styles.demoFilterTextActive]}>전체</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.demoFilterBtn, filter === 'running' && styles.demoFilterBtnActive]}
          onPress={() => setFilter('running')}>
          <Text style={[styles.demoFilterText, filter === 'running' && styles.demoFilterTextActive]}>운행중</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.demoFilterBtn, filter === 'completed' && styles.demoFilterBtnActive]}
          onPress={() => setFilter('completed')}>
          <Text style={[styles.demoFilterText, filter === 'completed' && styles.demoFilterTextActive]}>완료</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.countText}>
          표시 {filteredTrips.length}건 · 불러온 기록 {trips.length}건
        </Text>
        <TouchableOpacity
          accessibilityLabel="운행 기록 새로고침"
          onPress={handleRefresh}
          disabled={isRefreshing || isLoading}>
          <Text style={styles.reloadText}>새로고침</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.vehicleDropdownBtn} onPress={() => setShowVehiclePicker(true)}>
        <Text style={selectedVehicleId ? styles.vehicleDropdownText : styles.vehicleDropdownPlaceholder}>
          {selectedVehicleId ? (selectedVehicle?.vehicle_number ?? '차량 선택') : '전체 차량'}
        </Text>
        <Text style={styles.dropdownArrow}>▾</Text>
      </TouchableOpacity>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>필터 결과</Text>
          <Text style={styles.summaryValue}>{filteredSummary.total}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>완료</Text>
          <Text style={styles.summaryValue}>{filteredSummary.completed}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>운행 중</Text>
          <Text style={styles.summaryValue}>{filteredSummary.active}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>GPS</Text>
          <Text style={styles.summaryValue}>{filteredSummary.gpsPoints}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>GPS 누락</Text>
          <Text style={[styles.summaryValue, filteredSummary.completedWithoutGps > 0 && styles.warningValue]}>
            {filteredSummary.completedWithoutGps}
          </Text>
        </View>
        <View style={styles.summaryWideCard}>
          <Text style={styles.summaryLabel}>완료 평균 소요</Text>
          <Text style={styles.summaryValue}>{formatMinutes(filteredSummary.averageDuration)}</Text>
        </View>
      </View>

      {filteredSummary.completedWithoutGps > 0 && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            완료 운행 중 GPS 포인트가 없는 기록이 {filteredSummary.completedWithoutGps}건 있습니다. 위치 권한과 GPS 저장 상태를 확인해 주세요.
          </Text>
        </View>
      )}

      {runningCount > 1 && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            진행 중 운행이 {runningCount}건 있습니다. 운행 탭은 가장 최근 운행을 복구합니다.
          </Text>
        </View>
      )}

      {staleRunningCount > 0 && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>8시간 이상 종료되지 않은 운행이 {staleRunningCount}건 있습니다. 상세 또는 운행 탭에서 종료 여부를 확인해 주세요.</Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.noticeText}>운행 기록을 불러오는 중입니다.</Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>기록 조회 실패: {errorMessage}</Text>
        </View>
      )}

      {!isLoading && !errorMessage && trips.length === 0 && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>아직 표시할 운행 기록이 없습니다.</Text>
        </View>
      )}

      {!isLoading && !errorMessage && trips.length > 0 && filteredTrips.length === 0 && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>선택한 조건에 맞는 운행 기록이 없습니다.</Text>
        </View>
      )}

      <View style={styles.list}>
        {groupedTrips.map(({ date, trips: dateTrips }) => (
          <View key={date}>
            <Text style={styles.dateHeader}>{date}</Text>
            {dateTrips.map((trip) => {
              const vehicleNumber =
                (trip.vehicle_id && vehicleMap.get(trip.vehicle_id)) || '차량 정보 없음';
              const isRunning = trip.status === 'in_progress';
              const isStale = isRunning && isStaleActiveTrip(trip.start_time);
              const distanceLabel = trip.daily_km != null ? `${trip.daily_km}km` : '-';
              const odometerLabel = trip.total_km != null ? `${trip.total_km.toLocaleString()}km` : '-';
              const fuelLabel = trip.fuel_added_liters != null ? `${trip.fuel_added_liters}L` : '-';

              if (viewMode === 'list') {
                return (
                  <Link
                    key={trip.id}
                    href={{ pathname: '/trips/[id]', params: { id: trip.id } }}
                    asChild>
                    <TouchableOpacity accessibilityLabel="운행 상세 보기" style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listVehicle} numberOfLines={1}>{vehicleNumber}</Text>
                        <Text style={styles.listRoute} numberOfLines={1}>
                          {trip.start_place ?? '-'} → {trip.end_place ?? '-'}
                        </Text>
                        <Text style={styles.listTime}>{formatDateTime(trip.start_time)}</Text>
                      </View>
                      <Text style={[styles.statusBadge, isRunning && styles.runningBadge, isStale && styles.staleBadge]}>
                        {isStale ? '장시간' : getTripStatusText(trip.status)}
                      </Text>
                    </TouchableOpacity>
                  </Link>
                );
              }

              return (
                <View key={trip.id} style={styles.tripCard}>
                  <View style={styles.cardHeader}>
                    <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.vehicleText}>
                      {vehicleNumber}
                    </Text>
                    <Text style={[styles.statusBadge, isRunning && styles.runningBadge, isStale && styles.staleBadge]}>
                      {isStale ? '장시간 운행' : getTripStatusText(trip.status)}
                    </Text>
                  </View>
                  <View style={styles.routeRow}>
                    <Text style={styles.routeText}>{trip.start_place ?? '출발지'}</Text>
                    <Text style={styles.routeArrow}>→</Text>
                    <Text style={styles.routeText}>{trip.end_place ?? '목적지'}</Text>
                  </View>
                  <View style={styles.metricTileRow}>
                    <View style={styles.metricTile}>
                      <Text style={styles.metricLabel}>주행거리</Text>
                      <Text style={styles.metricValue}>{distanceLabel}</Text>
                    </View>
                    <View style={styles.metricTile}>
                      <Text style={styles.metricLabel}>누적거리</Text>
                      <Text style={styles.metricValue}>{odometerLabel}</Text>
                    </View>
                    <View style={styles.metricTile}>
                      <Text style={styles.metricLabel}>유류사용</Text>
                      <Text style={styles.metricValue}>{fuelLabel}</Text>
                    </View>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>출발</Text>
                    <Text style={styles.metaValue}>{formatDateTime(trip.start_time)}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>도착</Text>
                    <Text style={styles.metaValue}>{formatDateTime(trip.end_time)}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>소요</Text>
                    <Text style={styles.metaValue}>{formatTripDuration(trip.start_time, trip.end_time)}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>운행 목적</Text>
                    <Text style={styles.metaValue}>{trip.purpose ?? '-'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>운용자</Text>
                    <Text style={styles.metaValue}>
                      {[trip.operator_rank, trip.operator_name].filter(Boolean).join(' ') || '-'}
                    </Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>사용자</Text>
                    <Text style={styles.metaValue}>
                      {[trip.user_rank, trip.user_name].filter(Boolean).join(' ') || '-'}
                    </Text>
                  </View>
                  {(trip.daily_km !== null || trip.total_km !== null) && (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>주행거리</Text>
                      <Text style={styles.metaValue}>
                        일일 {trip.daily_km ?? '-'}km · 누적 {trip.total_km ?? '-'}km
                      </Text>
                    </View>
                  )}
                  {(trip.fuel_station || trip.fuel_added_liters !== null) && (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>유류</Text>
                      <Text style={styles.metaValue}>
                        {trip.fuel_station ?? '-'} {trip.fuel_added_liters !== null ? `${trip.fuel_added_liters}L` : ''}
                      </Text>
                    </View>
                  )}
                  {isStale && (
                    <View style={styles.staleBox}>
                      <Text style={styles.staleText}>8시간 이상 진행 중인 운행입니다. 실제 운행이 끝났다면 종료 화면에서 마감해 주세요.</Text>
                    </View>
                  )}
                  <View style={styles.cardActions}>
                    <Link
                      href={{
                        pathname: '/trips/[id]',
                        params: { id: trip.id },
                      }}
                      asChild>
                      <TouchableOpacity
                        accessibilityLabel="운행 상세 보기"
                        style={[styles.tripActionBtn, styles.secondaryActionBtn]}>
                        <Text style={[styles.tripActionText, styles.secondaryActionText]}>상세</Text>
                      </TouchableOpacity>
                    </Link>
                    {isRunning && (
                      <Link href="/" asChild>
                        <TouchableOpacity accessibilityLabel="운행 탭에서 종료하기" style={styles.tripActionBtn}>
                          <Text style={styles.tripActionText}>운행 탭에서 종료</Text>
                        </TouchableOpacity>
                      </Link>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {hasMoreTrips && !errorMessage && (
        <TouchableOpacity
          accessibilityLabel="운행 기록 더 보기"
          style={[styles.loadMoreBtn, (isLoadingMore || isLoading) && styles.disabledBtn]}
          onPress={handleLoadMore}
          disabled={isLoadingMore || isLoading}>
          {isLoadingMore ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            <Text style={styles.loadMoreText}>운행 기록 더 보기</Text>
          )}
        </TouchableOpacity>
      )}

      {/* 차량 선택 모달 */}
      <Modal
        visible={showVehiclePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowVehiclePicker(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowVehiclePicker(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>차량 선택</Text>
            <ScrollView style={styles.modalScroll}>
              <TouchableOpacity
                style={[styles.modalItem, selectedVehicleId === null && styles.modalItemActive]}
                onPress={() => { setSelectedVehicleId(null); setShowVehiclePicker(false); }}>
                <Text style={[styles.modalItemText, selectedVehicleId === null && styles.modalItemTextActive]}>전체 차량</Text>
                {selectedVehicleId === null && <Text style={styles.modalCheckmark}>✓</Text>}
              </TouchableOpacity>
              {vehicles.map((vehicle) => {
                const isSelected = selectedVehicleId === vehicle.id;
                return (
                  <TouchableOpacity
                    key={vehicle.id}
                    style={[styles.modalItem, isSelected && styles.modalItemActive]}
                    onPress={() => { setSelectedVehicleId(vehicle.id); setShowVehiclePicker(false); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>{vehicle.vehicle_number}</Text>
                      {vehicle.equipment_name ? (
                        <Text style={styles.modalItemSub}>{vehicle.equipment_name}</Text>
                      ) : null}
                    </View>
                    {isSelected && <Text style={styles.modalCheckmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 장비운행증 출력 모달 */}
      <Modal
        visible={pvModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPvModalVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPvModalVisible(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>장비운행증 출력</Text>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.pvSubtitle}>
                {selectedVehicle
                  ? `${selectedVehicle.vehicle_number}${selectedVehicle.equipment_name ? ` · ${selectedVehicle.equipment_name}` : ''}`
                  : '전 차량'}
              </Text>
              <View style={styles.pvDateRow}>
                <View style={styles.pvDateField}>
                  <Text style={styles.pvDateLabel}>시작일</Text>
                  <TextInput
                    style={styles.pvDateInput}
                    value={pvStartDate}
                    onChangeText={setPvStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <Text style={styles.pvDateSep}>~</Text>
                <View style={styles.pvDateField}>
                  <Text style={styles.pvDateLabel}>종료일</Text>
                  <TextInput
                    style={styles.pvDateInput}
                    value={pvEndDate}
                    onChangeText={setPvEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>
              <Text style={styles.pvCountText}>
                해당 기간 <Text style={styles.pvCountNum}>{pvTrips.length}건</Text>의 운행 기록이 출력됩니다.
              </Text>
              <TouchableOpacity
                style={styles.pvPrintBtn}
                onPress={handlePrintPv}>
                <Text style={styles.pvPrintBtnText}>출력하기</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  headerMeta: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  headerCsvBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  headerCsvText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  countText: {
    color: '#64748B',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    marginRight: 12,
    minWidth: 180,
  },
  reloadText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  vehicleDropdownBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  vehicleDropdownText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  vehicleDropdownPlaceholder: {
    color: '#94A3B8',
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  dropdownArrow: {
    color: '#94A3B8',
    fontSize: 16,
    marginLeft: 8,
  },
  modalItem: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  modalItemActive: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  modalItemText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
  },
  modalItemTextActive: {
    color: '#2563EB',
  },
  modalItemSub: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  modalCheckmark: {
    color: '#2563EB',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
  },
  exportBtn: {
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: 14,
    minHeight: 46,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  exportText: {
    color: '#059669',
    fontSize: 15,
    fontWeight: '600',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  summaryWideCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '100%',
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  summaryValue: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
  },
  warningValue: {
    color: '#DC2626',
  },
  list: {
    gap: 12,
  },
  tripCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECEAE4',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  vehicleText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    marginRight: 12,
    minWidth: 0,
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
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
  },
  staleBadge: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
  },
  routeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 14,
  },
  routeText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  routeArrow: {
    color: '#94A3B8',
    fontSize: 14,
    marginHorizontal: 8,
  },
  metricTileRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  metricTile: {
    backgroundColor: '#F5F5F3',
    borderRadius: 12,
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  metricLabel: {
    color: '#8C8F98',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 3,
  },
  metricValue: {
    color: '#1C2434',
    fontSize: 15,
    fontWeight: '900',
  },
  staleBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    marginBottom: 8,
    marginTop: 6,
    padding: 12,
  },
  staleText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '500',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 26,
  },
  metaLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  metaValue: {
    color: '#0F172A',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 14,
    textAlign: 'right',
  },
  warningMetaValue: {
    color: '#DC2626',
  },
  warningInlineBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    marginTop: 8,
    padding: 10,
  },
  warningInlineText: {
    color: '#B45309',
    fontSize: 13,
    fontWeight: '500',
  },
  tripActionBtn: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  secondaryActionBtn: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
  },
  tripActionText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryActionText: {
    color: '#64748B',
  },
  loadMoreBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 46,
  },
  loadMoreText: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '600',
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
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  viewToggleBar: {
    backgroundColor: '#E9EFED',
    borderRadius: 13,
    flexDirection: 'row',
    gap: 3,
    marginBottom: 16,
    padding: 4,
  },
  viewToggleBtn: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  viewToggleBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  viewToggleText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '800',
  },
  viewToggleTextActive: {
    color: '#1C2434',
    fontWeight: '900',
  },
  demoFilterBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  demoFilterBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 15,
  },
  demoFilterBtnActive: {
    backgroundColor: '#1C2434',
    borderColor: '#1C2434',
  },
  demoFilterText: {
    color: '#5A6273',
    fontSize: 14,
    fontWeight: '800',
  },
  demoFilterTextActive: {
    color: '#FFFFFF',
  },
  dateHeader: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 8,
    marginTop: 16,
  },
  listRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listRowLeft: {
    flex: 1,
    marginRight: 10,
  },
  listVehicle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  listRoute: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 2,
  },
  listTime: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '400',
  },
  // Modal overlay + sheet
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalScroll: {
    flexGrow: 0,
  },
  // PV modal content
  pvSubtitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 20,
    textAlign: 'center',
  },
  pvDateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  pvDateField: {
    flex: 1,
  },
  pvDateLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  pvDateInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '500',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  pvDateSep: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: '500',
    marginTop: 22,
  },
  pvCountText: {
    color: '#64748B',
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  pvCountNum: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  pvPrintBtn: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 4,
  },
  pvPrintBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
