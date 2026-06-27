import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
};

type Trip = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
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
type DateFilter = 'all' | 'today' | '7d' | '30d';
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

function getDateFilterStart(filter: DateFilter) {
  const now = new Date();

  if (filter === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }

  if (filter === '7d') {
    return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  }

  if (filter === '30d') {
    return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }

  return null;
}

function escapeCsvValue(value: string | number | null | undefined) {
  const text = String(value ?? '');

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
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

export default function TripHistoryScreen() {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [gpsSummaryByTripId, setGpsSummaryByTripId] = useState<Map<string, GpsSummary>>(new Map());
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_TRIP_LIMIT);
  const [hasMoreTrips, setHasMoreTrips] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const vehicleMap = useMemo(() => {
    return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicle_number]));
  }, [vehicles]);

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
    const normalizedSearchText = searchText.trim().toLowerCase();

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

      const filterStart = getDateFilterStart(dateFilter);
      if (filterStart !== null) {
        const startTime = getTripTime(trip.start_time);

        if (startTime === null || startTime < filterStart) {
          return false;
        }
      }

      const vehicleNumber = (trip.vehicle_id && vehicleMap.get(trip.vehicle_id)) || '차량 정보 없음';
      const routeText = `${vehicleNumber} ${trip.start_place ?? ''} ${trip.end_place ?? ''}`;

      return !normalizedSearchText || routeText.toLowerCase().includes(normalizedSearchText);
    });
  }, [dateFilter, filter, searchText, selectedVehicleId, trips, vehicleMap]);

  const handleExportCsv = useCallback(() => {
    if (filteredTrips.length === 0) {
      Alert.alert('내보내기 불가', '내보낼 운행 기록이 없습니다.');
      return;
    }

    const header = [
      '차량번호',
      '상태',
      '출발지',
      '목적지',
      '출발',
      '종료',
      '소요',
      'GPS수',
      '최근GPS',
    ];
    const rows = filteredTrips.map((trip) => {
      const gpsSummary = gpsSummaryByTripId.get(trip.id);
      const vehicleNumber = (trip.vehicle_id && vehicleMap.get(trip.vehicle_id)) || '차량 정보 없음';

      return [
        vehicleNumber,
        getTripStatusText(trip.status),
        trip.start_place ?? '',
        trip.end_place ?? '',
        formatDateTime(trip.start_time),
        formatDateTime(trip.end_time),
        formatTripDuration(trip.start_time, trip.end_time),
        gpsSummary?.count ?? 0,
        formatDateTime(gpsSummary?.latestRecordedAt ?? null),
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\r\n');
    const fileName = `vehicle-trips-${new Date().toISOString().slice(0, 10)}.csv`;

    if (Platform.OS !== 'web') {
      Alert.alert('CSV 내보내기 안내', '현재 CSV 파일 저장은 웹 브라우저에서 사용할 수 있습니다.');
      return;
    }

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredTrips, gpsSummaryByTripId, vehicleMap]);

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
            .select('id, vehicle_id, start_place, end_place, start_time, end_time, status')
            .order('start_time', { ascending: false })
            .range(0, nextLimit),
          '운행 기록'
        ),
        withTimeout(supabase.from('vehicles').select('id, vehicle_number'), '차량 목록'),
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
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom + 96, 112),
          paddingTop: Math.max(insets.top + 24, 56),
        },
      ]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
      }>
      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <Text style={styles.heroEmoji}>📒</Text>
        </View>
        <View style={styles.heroTextBox}>
          <Text style={styles.heroEyebrow}>운행 로그</Text>
          <Text style={styles.title}>운행 기록</Text>
          <Text style={styles.heroSubtitle}>차량별 운행, GPS 누락, 장시간 운행을 빠르게 확인합니다.</Text>
        </View>
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

      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'all' && styles.activeFilterBtn]}
          onPress={() => setFilter('all')}>
          <Text style={[styles.filterText, filter === 'all' && styles.activeFilterText]}>
            전체 {trips.length}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'running' && styles.activeFilterBtn]}
          onPress={() => setFilter('running')}>
          <Text style={[styles.filterText, filter === 'running' && styles.activeFilterText]}>
            운행 중 {runningCount}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'completed' && styles.activeFilterBtn]}
          onPress={() => setFilter('completed')}>
          <Text style={[styles.filterText, filter === 'completed' && styles.activeFilterText]}>
            완료 {completedCount}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'canceled' && styles.activeFilterBtn]}
          onPress={() => setFilter('canceled')}>
          <Text style={[styles.filterText, filter === 'canceled' && styles.activeFilterText]}>
            무효 {canceledCount}
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        value={searchText}
        onChangeText={setSearchText}
        placeholder="차량번호, 출발지, 목적지 검색"
        placeholderTextColor="#98A2B3"
      />

      <View style={styles.filterPanel}>
        <Text style={styles.filterPanelTitle}>기간</Text>
        <View style={styles.chipRow}>
          {[
            ['all', '전체'],
            ['today', '오늘'],
            ['7d', '7일'],
            ['30d', '30일'],
          ].map(([value, label]) => {
            const nextFilter = value as DateFilter;
            const isSelected = dateFilter === nextFilter;

            return (
              <TouchableOpacity
                key={value}
                style={[styles.chipBtn, isSelected && styles.activeChipBtn]}
                onPress={() => setDateFilter(nextFilter)}>
                <Text style={[styles.chipText, isSelected && styles.activeChipText]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.filterPanelTitle}>차량</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chipBtn, selectedVehicleId === null && styles.activeChipBtn]}
            onPress={() => setSelectedVehicleId(null)}>
            <Text style={[styles.chipText, selectedVehicleId === null && styles.activeChipText]}>전체</Text>
          </TouchableOpacity>
          {vehicles.map((vehicle) => {
            const isSelected = selectedVehicleId === vehicle.id;

            return (
              <TouchableOpacity
                key={vehicle.id}
                style={[styles.chipBtn, isSelected && styles.activeChipBtn]}
                onPress={() => setSelectedVehicleId(vehicle.id)}>
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  numberOfLines={1}
                  style={[styles.chipText, isSelected && styles.activeChipText]}>
                  {vehicle.vehicle_number}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        accessibilityLabel="운행 기록 CSV 내보내기"
        style={[styles.exportBtn, filteredTrips.length === 0 && styles.disabledBtn]}
        onPress={handleExportCsv}
        disabled={filteredTrips.length === 0}>
        <Text style={styles.exportText}>CSV 내보내기</Text>
      </TouchableOpacity>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>📋</Text>
          <View>
            <Text style={styles.summaryLabel}>필터 결과</Text>
            <Text style={styles.summaryValue}>{filteredSummary.total}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>✅</Text>
          <View>
            <Text style={styles.summaryLabel}>완료</Text>
            <Text style={styles.summaryValue}>{filteredSummary.completed}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>⚡</Text>
          <View>
            <Text style={styles.summaryLabel}>운행 중</Text>
            <Text style={styles.summaryValue}>{filteredSummary.active}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>📍</Text>
          <View>
            <Text style={styles.summaryLabel}>GPS</Text>
            <Text style={styles.summaryValue}>{filteredSummary.gpsPoints}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>🚨</Text>
          <View>
            <Text style={styles.summaryLabel}>GPS 누락</Text>
            <Text style={[styles.summaryValue, filteredSummary.completedWithoutGps > 0 && styles.warningValue]}>
              {filteredSummary.completedWithoutGps}
            </Text>
          </View>
        </View>
        <View style={styles.summaryWideCard}>
          <Text style={styles.summaryEmoji}>⏱️</Text>
          <View>
            <Text style={styles.summaryLabel}>완료 평균 소요</Text>
            <Text style={styles.summaryValue}>{formatMinutes(filteredSummary.averageDuration)}</Text>
          </View>
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
          <ActivityIndicator color="#A8FF5F" />
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
        {filteredTrips.map((trip) => {
          const vehicleNumber =
            (trip.vehicle_id && vehicleMap.get(trip.vehicle_id)) || '차량 정보 없음';
          const isRunning = trip.status === 'in_progress';
          const isStale = isRunning && isStaleActiveTrip(trip.start_time);
          const gpsSummary = gpsSummaryByTripId.get(trip.id);

          return (
            <View key={trip.id} style={styles.tripCard}>
              <View style={styles.cardHeader}>
                <View style={styles.vehicleTitleWrap}>
                  <View style={styles.vehicleIcon}>
                    <Text style={styles.vehicleEmoji}>{isRunning ? '🚚' : '🚗'}</Text>
                  </View>
                  <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.vehicleText}>
                    {vehicleNumber}
                  </Text>
                </View>
                <Text style={[styles.statusBadge, isRunning && styles.runningBadge, isStale && styles.staleBadge]}>
                  {isStale ? '장시간 운행' : getTripStatusText(trip.status)}
                </Text>
              </View>
              <View style={styles.routeRow}>
                <Text style={styles.routeText}>{trip.start_place ?? '출발지'}</Text>
                <Text style={styles.routeArrow}>→</Text>
                <Text style={styles.routeText}>{trip.end_place ?? '목적지'}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>출발</Text>
                <Text style={styles.metaValue}>{formatDateTime(trip.start_time)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>종료</Text>
                <Text style={styles.metaValue}>{formatDateTime(trip.end_time)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>소요</Text>
                <Text style={styles.metaValue}>
                  {formatTripDuration(trip.start_time, trip.end_time)}
                </Text>
              </View>
              {isStale && (
                <View style={styles.staleBox}>
                  <Text style={styles.staleText}>8시간 이상 진행 중인 운행입니다. 실제 운행이 끝났다면 종료 화면에서 마감해 주세요.</Text>
                </View>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>GPS</Text>
                <Text
                  style={[
                    styles.metaValue,
                    trip.status === 'completed' && !gpsSummary?.count && styles.warningMetaValue,
                  ]}>
                  {gpsSummary?.count ?? 0}개 수집
                </Text>
              </View>
              {trip.status === 'completed' && !gpsSummary?.count && (
                <View style={styles.warningInlineBox}>
                  <Text style={styles.warningInlineText}>완료 운행이지만 GPS 포인트가 없습니다.</Text>
                </View>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>최근 수집</Text>
                <Text style={styles.metaValue}>
                  {formatDateTime(gpsSummary?.latestRecordedAt ?? null)}
                </Text>
              </View>
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

      {hasMoreTrips && !errorMessage && (
        <TouchableOpacity
          accessibilityLabel="운행 기록 더 보기"
          style={[styles.loadMoreBtn, (isLoadingMore || isLoading) && styles.disabledBtn]}
          onPress={handleLoadMore}
          disabled={isLoadingMore || isLoading}>
          {isLoadingMore ? (
            <ActivityIndicator color="#A8FF5F" />
          ) : (
            <Text style={styles.loadMoreText}>운행 기록 더 보기</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#101314',
    padding: 18,
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
    padding: 16,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#0A0B0A',
    borderColor: '#80FF2F',
    borderRadius: 18,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  heroEmoji: {
    fontSize: 30,
  },
  heroTextBox: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    color: '#A8FF5F',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
  },
  heroSubtitle: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 4,
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
    color: '#A6ADB8',
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    marginRight: 12,
    minWidth: 180,
  },
  reloadText: {
    color: '#A8FF5F',
    fontSize: 14,
    fontWeight: '900',
  },
  filterBar: {
    backgroundColor: '#1B1D20',
    borderRadius: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 14,
    padding: 4,
  },
  searchInput: {
    backgroundColor: '#1F2023',
    borderColor: '#3D444D',
    borderRadius: 12,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 14,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  filterPanel: {
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  filterPanelTitle: {
    color: '#A6ADB8',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chipBtn: {
    backgroundColor: '#2F3440',
    borderRadius: 20,
    flexShrink: 1,
    minHeight: 44,
    justifyContent: 'center',
    maxWidth: '100%',
    paddingHorizontal: 14,
  },
  activeChipBtn: {
    backgroundColor: '#A8FF5F',
  },
  chipText: {
    color: '#E6EBF2',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  activeChipText: {
    color: '#111827',
    fontWeight: '900',
  },
  exportBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 12,
    justifyContent: 'center',
    marginBottom: 14,
    minHeight: 46,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  exportText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  summaryWideCard: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: '100%',
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  summaryEmoji: {
    fontSize: 24,
  },
  summaryLabel: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  summaryValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  warningValue: {
    color: '#FF8585',
  },
  filterBtn: {
    alignItems: 'center',
    borderRadius: 9,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  activeFilterBtn: {
    backgroundColor: '#A8FF5F',
  },
  filterText: {
    color: '#A6ADB8',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
    textAlign: 'center',
  },
  activeFilterText: {
    color: '#111827',
    fontWeight: '900',
  },
  list: {
    gap: 12,
  },
  tripCard: {
    backgroundColor: '#232326',
    borderColor: '#30343A',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
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
    color: '#FFFFFF',
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    marginRight: 12,
    minWidth: 0,
  },
  vehicleTitleWrap: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  vehicleIcon: {
    alignItems: 'center',
    backgroundColor: '#080A08',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  vehicleEmoji: {
    fontSize: 25,
  },
  statusBadge: {
    backgroundColor: '#183F28',
    borderRadius: 20,
    color: '#A8FF5F',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  runningBadge: {
    backgroundColor: '#183F28',
    color: '#A8FF5F',
  },
  staleBadge: {
    backgroundColor: '#4A1C1C',
    color: '#FF8585',
  },
  routeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 10,
  },
  routeText: {
    color: '#E6EBF2',
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
  },
  routeArrow: {
    color: '#A8FF5F',
    fontSize: 14,
    marginHorizontal: 8,
  },
  staleBox: {
    backgroundColor: '#3A1C1C',
    borderRadius: 10,
    marginBottom: 8,
    marginTop: 6,
    padding: 12,
  },
  staleText: {
    color: '#FF8585',
    fontSize: 13,
    fontWeight: '800',
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
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '800',
  },
  metaValue: {
    color: '#E6EBF2',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 14,
    textAlign: 'right',
  },
  warningMetaValue: {
    color: '#FF8585',
  },
  warningInlineBox: {
    backgroundColor: '#4A3A12',
    borderRadius: 8,
    marginTop: 8,
    padding: 10,
  },
  warningInlineText: {
    color: '#FFD65C',
    fontSize: 13,
    fontWeight: '800',
  },
  tripActionBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 10,
    flex: 1,
    minHeight: 44,
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
    backgroundColor: '#2F3440',
  },
  tripActionText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryActionText: {
    color: '#E6EBF2',
  },
  loadMoreBtn: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#3D444D',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 46,
  },
  loadMoreText: {
    color: '#A8FF5F',
    fontSize: 15,
    fontWeight: '900',
  },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#A8FF5F',
    flex: 1,
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
});
