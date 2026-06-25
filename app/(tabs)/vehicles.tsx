import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  TextInput,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '../../lib/supabase';
import { formatDateTime, formatTripDuration, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type Vehicle = {
  id: string;
  vehicle_number: string;
};

type Trip = {
  id: string;
  vehicle_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
};

type VehicleStatusFilter = 'all' | 'active' | 'waiting' | 'stale';

function normalizeVehicleNumber(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editingVehicleNumber, setEditingVehicleNumber] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<VehicleStatusFilter>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeTripsByVehicleId = useMemo(() => {
    const map = new Map<string, Trip>();

    trips
      .filter((trip) => trip.status === 'in_progress' && trip.vehicle_id)
      .forEach((trip) => {
        if (trip.vehicle_id && !map.has(trip.vehicle_id)) {
          map.set(trip.vehicle_id, trip);
        }
      });

    return map;
  }, [trips]);

  const latestTripsByVehicleId = useMemo(() => {
    const map = new Map<string, Trip>();

    trips.forEach((trip) => {
      if (!trip.vehicle_id || map.has(trip.vehicle_id)) {
        return;
      }

      map.set(trip.vehicle_id, trip);
    });

    return map;
  }, [trips]);

  const tripCountsByVehicleId = useMemo(() => {
    const map = new Map<string, { total: number; completed: number; active: number }>();

    trips.forEach((trip) => {
      if (!trip.vehicle_id) {
        return;
      }

      const current = map.get(trip.vehicle_id) ?? { total: 0, completed: 0, active: 0 };
      map.set(trip.vehicle_id, {
        total: current.total + 1,
        completed: current.completed + (trip.status === 'completed' ? 1 : 0),
        active: current.active + (trip.status === 'in_progress' ? 1 : 0),
      });
    });

    return map;
  }, [trips]);

  const vehicleSummary = useMemo(() => {
    return vehicles.reduce(
      (summary, vehicle) => {
        const activeTrip = activeTripsByVehicleId.get(vehicle.id) ?? null;
        const activeCount = tripCountsByVehicleId.get(vehicle.id)?.active ?? 0;
        const isStale = isStaleActiveTrip(activeTrip?.start_time ?? null);

        return {
          active: summary.active + (activeTrip ? 1 : 0),
          duplicatedActive: summary.duplicatedActive + (activeCount > 1 ? 1 : 0),
          stale: summary.stale + (isStale ? 1 : 0),
          total: summary.total + 1,
          waiting: summary.waiting + (!activeTrip ? 1 : 0),
        };
      },
      { active: 0, duplicatedActive: 0, stale: 0, total: 0, waiting: 0 }
    );
  }, [activeTripsByVehicleId, tripCountsByVehicleId, vehicles]);

  const filteredVehicles = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return vehicles.filter((vehicle) => {
      const activeTrip = activeTripsByVehicleId.get(vehicle.id) ?? null;
      const isStale = isStaleActiveTrip(activeTrip?.start_time ?? null);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && activeTrip) ||
        (statusFilter === 'waiting' && !activeTrip) ||
        (statusFilter === 'stale' && isStale);

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return vehicle.vehicle_number.toLowerCase().includes(normalizedSearch);
    });
  }, [activeTripsByVehicleId, searchText, statusFilter, vehicles]);

  const loadVehicles = useCallback(async (refreshing = false) => {
    if (refreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setErrorMessage(null);

    try {
      const [vehiclesResult, tripsResult] = await Promise.all([
        withTimeout(
          supabase.from('vehicles').select('id, vehicle_number').order('vehicle_number'),
          '차량 목록'
        ),
        withTimeout(
          supabase
            .from('trips')
            .select('id, vehicle_id, start_time, end_time, status')
            .order('start_time', { ascending: false })
            .limit(100),
          '운행 목록'
        ),
      ]);

      if (vehiclesResult.error) {
        setVehicles([]);
        setErrorMessage(formatDbError(vehiclesResult.error, '차량 목록을 불러오는 중 오류가 발생했습니다.'));
      } else {
        setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
      }

      if (tripsResult.error) {
        setTrips([]);
        setErrorMessage((current) => current ?? formatDbError(tripsResult.error));
      } else {
        setTrips((tripsResult.data ?? []) as Trip[]);
      }
    } catch (error) {
      setVehicles([]);
      setTrips([]);
      setErrorMessage(
        formatDbError(error, '차량 상태를 불러오는 중 오류가 발생했습니다.')
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleCreateVehicle = useCallback(async () => {
    const vehicleNumber = normalizeVehicleNumber(newVehicleNumber);

    if (!vehicleNumber || isSaving) {
      return;
    }

    if (vehicles.some((vehicle) => normalizeVehicleNumber(vehicle.vehicle_number) === vehicleNumber)) {
      setErrorMessage('이미 등록된 차량번호입니다. 차량번호를 확인해 주세요.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const { error } = await withTimeout(
        supabase.from('vehicles').insert({ vehicle_number: vehicleNumber }),
        '차량 등록'
      );

      if (error) {
        setErrorMessage(formatDbError(error, '차량 등록 중 오류가 발생했습니다.'));
        return;
      }

      setNewVehicleNumber('');
      await loadVehicles(true);
    } catch (error) {
      setErrorMessage(formatDbError(error, '차량 등록 중 오류가 발생했습니다.'));
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, loadVehicles, newVehicleNumber, vehicles]);

  const startEditVehicle = useCallback((vehicle: Vehicle) => {
    setEditingVehicleId(vehicle.id);
    setEditingVehicleNumber(vehicle.vehicle_number);
  }, []);

  const cancelEditVehicle = useCallback(() => {
    setEditingVehicleId(null);
    setEditingVehicleNumber('');
  }, []);

  const handleDeleteVehicle = useCallback(
    (vehicle: Vehicle) => {
      if (isSaving) {
        return;
      }

      Alert.alert('차량 삭제', `${vehicle.vehicle_number} 차량을 삭제할까요?`, [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            setIsSaving(true);
            setErrorMessage(null);

            try {
              const tripCountResult = await withTimeout(
                supabase
                  .from('trips')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicle.id),
                '차량 삭제 전 운행 기록 확인'
              );

              if (tripCountResult.error) {
                setErrorMessage(
                  formatDbError(tripCountResult.error, '차량 삭제 전 운행 기록 확인 중 오류가 발생했습니다.')
                );
                return;
              }

              if ((tripCountResult.count ?? 0) > 0) {
                setErrorMessage('운행 기록이 있는 차량은 삭제할 수 없습니다. 차량번호 수정만 가능합니다.');
                await loadVehicles(true);
                return;
              }

              const { error } = await withTimeout(
                supabase.from('vehicles').delete().eq('id', vehicle.id),
                '차량 삭제'
              );

              if (error) {
                setErrorMessage(formatDbError(error, '차량 삭제 중 오류가 발생했습니다.'));
                return;
              }

              await loadVehicles(true);
            } catch (error) {
              setErrorMessage(
                formatDbError(error, '차량 삭제 중 오류가 발생했습니다.')
              );
            } finally {
              setIsSaving(false);
            }
          },
        },
      ]);
    },
    [isSaving, loadVehicles]
  );

  const handleUpdateVehicle = useCallback(
    async (vehicleId: string) => {
      const vehicleNumber = normalizeVehicleNumber(editingVehicleNumber);

      if (!vehicleNumber || isSaving) {
        return;
      }

      if (
        vehicles.some(
          (vehicle) =>
            vehicle.id !== vehicleId && normalizeVehicleNumber(vehicle.vehicle_number) === vehicleNumber
        )
      ) {
        setErrorMessage('이미 등록된 차량번호입니다. 차량번호를 확인해 주세요.');
        return;
      }

      setIsSaving(true);
      setErrorMessage(null);

      try {
        const { error } = await withTimeout(
          supabase.from('vehicles').update({ vehicle_number: vehicleNumber }).eq('id', vehicleId),
          '차량 수정'
        );

        if (error) {
          setErrorMessage(formatDbError(error, '차량 수정 중 오류가 발생했습니다.'));
          return;
        }

        cancelEditVehicle();
        await loadVehicles(true);
      } catch (error) {
        setErrorMessage(formatDbError(error, '차량 수정 중 오류가 발생했습니다.'));
      } finally {
        setIsSaving(false);
      }
    },
    [cancelEditVehicle, editingVehicleNumber, isSaving, loadVehicles, vehicles]
  );

  useFocusEffect(
    useCallback(() => {
      loadVehicles();
    }, [loadVehicles])
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={() => loadVehicles(true)} />
      }>
      <Text style={styles.eyebrow}>VEHICLES</Text>
      <Text style={styles.title}>차량 상태</Text>

      <View style={styles.toolbar}>
        <Text style={styles.countText}>
          표시 {filteredVehicles.length}대 · 등록 {vehicles.length}대
        </Text>
        <TouchableOpacity
          accessibilityLabel="차량 상태 새로고침"
          onPress={() => loadVehicles(true)}
          disabled={isRefreshing || isLoading}>
          <Text style={styles.reloadText}>새로고침</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>등록</Text>
          <Text style={styles.summaryValue}>{vehicleSummary.total}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>운행 중</Text>
          <Text style={styles.summaryValue}>{vehicleSummary.active}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>대기 중</Text>
          <Text style={styles.summaryValue}>{vehicleSummary.waiting}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>장시간</Text>
          <Text style={[styles.summaryValue, vehicleSummary.stale > 0 && styles.warningValue]}>
            {vehicleSummary.stale}
          </Text>
        </View>
        <View style={styles.summaryWideCard}>
          <Text style={styles.summaryLabel}>중복 미종료</Text>
          <Text style={[styles.summaryValue, vehicleSummary.duplicatedActive > 0 && styles.warningValue]}>
            {vehicleSummary.duplicatedActive}
          </Text>
        </View>
      </View>

      {vehicleSummary.duplicatedActive > 0 && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            같은 차량에 미종료 운행이 여러 건 있는 차량이 {vehicleSummary.duplicatedActive}대 있습니다. 차량별 상세에서 정상 운행만 남기고 나머지는 무효 처리해 주세요.
          </Text>
        </View>
      )}

      <View style={styles.managePanel}>
        <Text style={styles.sectionTitle}>차량 등록</Text>
        <View style={styles.formRow}>
          <TextInput
            style={styles.textInput}
            value={newVehicleNumber}
            onChangeText={setNewVehicleNumber}
            placeholder="차량번호 입력"
            placeholderTextColor="#98A2B3"
          />
          <TouchableOpacity
            accessibilityLabel="차량 등록"
            style={[styles.compactBtn, (!newVehicleNumber.trim() || isSaving) && styles.disabledBtn]}
            onPress={handleCreateVehicle}
            disabled={!newVehicleNumber.trim() || isSaving}>
            <Text style={styles.compactBtnText}>{isSaving ? '저장 중' : '등록'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchPanel}>
        <Text style={styles.filterPanelTitle}>차량 검색</Text>
        <TextInput
          style={styles.searchInput}
          value={searchText}
          onChangeText={setSearchText}
          placeholder="차량번호 검색"
          placeholderTextColor="#98A2B3"
        />
      </View>

      <View style={styles.filterBar}>
        {[
          ['all', `전체 ${vehicleSummary.total}`],
          ['active', `운행 중 ${vehicleSummary.active}`],
          ['waiting', `대기 ${vehicleSummary.waiting}`],
          ['stale', `장시간 ${vehicleSummary.stale}`],
        ].map(([value, label]) => {
          const nextFilter = value as VehicleStatusFilter;
          const isSelected = statusFilter === nextFilter;

          return (
            <TouchableOpacity
              key={value}
              style={[styles.filterBtn, isSelected && styles.activeFilterBtn]}
              onPress={() => setStatusFilter(nextFilter)}>
              <Text style={[styles.filterText, isSelected && styles.activeFilterText]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#1565C0" />
          <Text style={styles.noticeText}>차량 상태를 불러오는 중입니다.</Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>차량 처리 안내: {errorMessage}</Text>
        </View>
      )}

      {!isLoading && !errorMessage && vehicles.length === 0 && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>등록된 차량이 없습니다.</Text>
        </View>
      )}

      {!isLoading && !errorMessage && vehicles.length > 0 && filteredVehicles.length === 0 && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>선택한 조건에 맞는 차량이 없습니다.</Text>
        </View>
      )}

      <View style={styles.list}>
        {filteredVehicles.map((vehicle) => {
          const activeTrip = activeTripsByVehicleId.get(vehicle.id) ?? null;
          const latestTrip = latestTripsByVehicleId.get(vehicle.id) ?? null;
          const counts = tripCountsByVehicleId.get(vehicle.id) ?? {
            total: 0,
            completed: 0,
            active: 0,
          };
          const statusText = activeTrip ? '운행 중' : '대기 중';
          const isStale = isStaleActiveTrip(activeTrip?.start_time ?? null);
          const canDelete = counts.total === 0 && !activeTrip;

          return (
            <View key={vehicle.id} style={styles.vehicleCard}>
              <View style={styles.cardHeader}>
                {editingVehicleId === vehicle.id ? (
                  <TextInput
                    style={[styles.textInput, styles.editInput]}
                    value={editingVehicleNumber}
                    onChangeText={setEditingVehicleNumber}
                    autoFocus
                    placeholder="차량번호"
                    placeholderTextColor="#98A2B3"
                  />
                ) : (
                  <Text style={styles.vehicleNumber}>{vehicle.vehicle_number}</Text>
                )}
                <Text style={[styles.statusBadge, activeTrip && styles.runningBadge, isStale && styles.staleBadge]}>
                  {isStale ? '장시간 운행' : statusText}
                </Text>
              </View>

              <InfoRow label="최근 출발" value={formatDateTime(latestTrip?.start_time ?? null)} />
              <InfoRow label="최근 종료" value={formatDateTime(latestTrip?.end_time ?? null)} />
              <InfoRow
                label="최근 소요"
                value={formatTripDuration(
                  latestTrip?.start_time ?? null,
                  latestTrip?.end_time ?? null
                )}
              />
              <InfoRow label="전체 운행" value={`${counts.total}건`} />
              <InfoRow label="완료 운행" value={`${counts.completed}건`} />
              <InfoRow label="미종료 운행" value={`${counts.active}건`} />

              {isStale && (
                <View style={styles.staleBox}>
                  <Text style={styles.staleText}>8시간 이상 종료되지 않은 운행입니다. 운행 화면에서 상태를 확인해 주세요.</Text>
                </View>
              )}

              {counts.active > 1 && (
                <View style={styles.warningInlineBox}>
                  <Text style={styles.warningInlineText}>
                    이 차량에 미종료 운행이 {counts.active}건 있습니다. 최신 운행 외 기록은 상세 화면에서 확인해 주세요.
                  </Text>
                </View>
              )}

              {editingVehicleId === vehicle.id && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, !editingVehicleNumber.trim() && styles.disabledBtn]}
                    onPress={() => handleUpdateVehicle(vehicle.id)}
                    disabled={!editingVehicleNumber.trim() || isSaving}>
                    <Text style={styles.actionText}>수정 저장</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.secondaryBtn]} onPress={cancelEditVehicle}>
                    <Text style={[styles.actionText, styles.secondaryText]}>취소</Text>
                  </TouchableOpacity>
                </View>
              )}

              {editingVehicleId !== vehicle.id && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    accessibilityLabel={`${vehicle.vehicle_number} 차량번호 수정`}
                    style={[styles.actionBtn, styles.secondaryBtn]}
                    onPress={() => startEditVehicle(vehicle)}>
                    <Text style={[styles.actionText, styles.secondaryText]}>차량번호 수정</Text>
                  </TouchableOpacity>
                  {canDelete && (
                    <TouchableOpacity
                      accessibilityLabel={`${vehicle.vehicle_number} 차량 삭제`}
                      style={[styles.actionBtn, styles.dangerBtn]}
                      onPress={() => handleDeleteVehicle(vehicle)}
                      disabled={isSaving}>
                      <Text style={[styles.actionText, styles.dangerText]}>삭제</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {activeTrip ? (
                <View style={styles.actions}>
                  <Link
                    href={{
                      pathname: '/trips/[id]',
                      params: { id: activeTrip.id },
                    }}
                    asChild>
                    <TouchableOpacity accessibilityLabel={`${vehicle.vehicle_number} 운행 상세 보기`} style={styles.actionBtn}>
                      <Text style={styles.actionText}>운행 상세</Text>
                    </TouchableOpacity>
                  </Link>
                <Link href="/" asChild>
                    <TouchableOpacity accessibilityLabel="운행 종료 화면으로 이동" style={[styles.actionBtn, styles.secondaryBtn]}>
                      <Text style={[styles.actionText, styles.secondaryText]}>종료 화면</Text>
                    </TouchableOpacity>
                  </Link>
                </View>
              ) : latestTrip ? (
                <Link
                  href={{
                    pathname: '/trips/[id]',
                    params: { id: latestTrip.id },
                  }}
                  asChild>
                  <TouchableOpacity
                    accessibilityLabel={`${vehicle.vehicle_number} 최근 운행 상세 보기`}
                    style={[styles.actionBtn, styles.secondaryBtn, styles.singleAction]}>
                    <Text style={[styles.actionText, styles.secondaryText]}>최근 운행 상세</Text>
                  </TouchableOpacity>
                </Link>
              ) : null}
            </View>
          );
        })}
      </View>
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
    backgroundColor: '#F6F8FB',
    padding: 20,
    paddingTop: 72,
  },
  eyebrow: {
    color: '#4F6F52',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 8,
  },
  title: {
    color: '#101828',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 18,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  managePanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8EF',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  formRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CFD7E6',
    borderRadius: 8,
    borderWidth: 1,
    color: '#101828',
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  editInput: {
    marginRight: 12,
  },
  compactBtn: {
    alignItems: 'center',
    backgroundColor: '#1565C0',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 76,
    paddingHorizontal: 14,
  },
  compactBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  countText: {
    color: '#667085',
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    marginRight: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8EF',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
  },
  summaryWideCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8EF',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '100%',
    padding: 14,
  },
  summaryLabel: {
    color: '#667085',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 6,
  },
  summaryValue: {
    color: '#101828',
    fontSize: 22,
    fontWeight: '900',
  },
  warningValue: {
    color: '#A8071A',
  },
  sectionTitle: {
    color: '#25324B',
    fontSize: 18,
    fontWeight: '900',
  },
  reloadText: {
    color: '#1565C0',
    fontSize: 14,
    fontWeight: '800',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CFD7E6',
    borderRadius: 8,
    borderWidth: 1,
    color: '#101828',
    fontSize: 15,
    fontWeight: '700',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  searchPanel: {
    marginBottom: 14,
  },
  filterPanelTitle: {
    color: '#667085',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
  },
  filterBar: {
    backgroundColor: '#EAF0F7',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
    padding: 4,
  },
  filterBtn: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  activeFilterBtn: {
    backgroundColor: '#FFFFFF',
  },
  filterText: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  activeFilterText: {
    color: '#1565C0',
  },
  list: {
    gap: 12,
  },
  vehicleCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8EF',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vehicleNumber: {
    color: '#101828',
    flex: 1,
    fontSize: 20,
    fontWeight: '900',
    marginRight: 12,
  },
  statusBadge: {
    backgroundColor: '#FFF7E6',
    borderRadius: 8,
    color: '#8C5A00',
    fontSize: 13,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  runningBadge: {
    backgroundColor: '#EAF2FF',
    color: '#1565C0',
  },
  staleBadge: {
    backgroundColor: '#FFF1F0',
    color: '#A8071A',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 30,
  },
  infoLabel: {
    color: '#667085',
    fontSize: 14,
    fontWeight: '800',
  },
  infoValue: {
    color: '#25324B',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 14,
    textAlign: 'right',
  },
  staleBox: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFCCC7',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  staleText: {
    color: '#A8071A',
    fontSize: 13,
    fontWeight: '800',
  },
  warningInlineBox: {
    backgroundColor: '#FFF7E6',
    borderColor: '#FFD591',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  warningInlineText: {
    color: '#8C5A00',
    fontSize: 13,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: '#1565C0',
    borderRadius: 8,
    flexBasis: 132,
    flexGrow: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  singleAction: {
    marginTop: 12,
  },
  secondaryBtn: {
    backgroundColor: '#EEF4FF',
  },
  dangerBtn: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFCCC7',
    borderWidth: 1,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryText: {
    color: '#1565C0',
  },
  dangerText: {
    color: '#A8071A',
  },
  disabledBtn: {
    opacity: 0.45,
  },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#EAF2FF',
    borderColor: '#BBD7FF',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#1D4E89',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFCCC7',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  errorText: {
    color: '#A8071A',
    fontSize: 15,
    fontWeight: '700',
  },
  warningBox: {
    backgroundColor: '#FFF7E6',
    borderColor: '#FFD591',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  warningText: {
    color: '#8C5A00',
    fontSize: 14,
    fontWeight: '700',
  },
});
