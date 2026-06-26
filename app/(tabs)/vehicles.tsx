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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

type VehicleTripCounts = {
  active: number;
  completed: number;
  total: number;
};

type VehicleStatusFilter = 'all' | 'active' | 'waiting' | 'stale';

type MaintenanceWarning = {
  overdue: number;
  warning: number;
};

function normalizeVehicleNumber(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export default function VehiclesScreen() {
  const insets = useSafeAreaInsets();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [exactTripCountsByVehicleId, setExactTripCountsByVehicleId] = useState<Map<string, VehicleTripCounts>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editingVehicleNumber, setEditingVehicleNumber] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<VehicleStatusFilter>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maintenanceWarnings, setMaintenanceWarnings] = useState<Map<string, MaintenanceWarning>>(new Map());

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

  const vehicleSummary = useMemo(() => {
    return vehicles.reduce(
      (summary, vehicle) => {
        const activeTrip = activeTripsByVehicleId.get(vehicle.id) ?? null;
        const activeCount = exactTripCountsByVehicleId.get(vehicle.id)?.active ?? 0;
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
  }, [activeTripsByVehicleId, exactTripCountsByVehicleId, vehicles]);

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

      const nextVehicles = vehiclesResult.error ? [] : ((vehiclesResult.data ?? []) as Vehicle[]);

      if (vehiclesResult.error) {
        setVehicles([]);
        setExactTripCountsByVehicleId(new Map());
        setErrorMessage(formatDbError(vehiclesResult.error, '차량 목록을 불러오는 중 오류가 발생했습니다.'));
      } else {
        setVehicles(nextVehicles);
      }

      if (tripsResult.error) {
        setTrips([]);
        setErrorMessage((current) => current ?? formatDbError(tripsResult.error));
      } else {
        setTrips((tripsResult.data ?? []) as Trip[]);
      }

      if (!vehiclesResult.error && nextVehicles.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const vehicleIds = nextVehicles.map((v) => v.id);
        const [overdueResult, warningResult] = await Promise.all([
          withTimeout(
            supabase
              .from('vehicle_maintenance')
              .select('vehicle_id')
              .in('vehicle_id', vehicleIds)
              .not('next_due_date', 'is', null)
              .lt('next_due_date', today),
            '교체 필요 조회'
          ),
          withTimeout(
            supabase
              .from('vehicle_maintenance')
              .select('vehicle_id, next_due_date')
              .in('vehicle_id', vehicleIds)
              .not('next_due_date', 'is', null)
              .gte('next_due_date', today),
            '교체 주의 조회'
          ),
        ]);

        const warnMap = new Map<string, MaintenanceWarning>();
        nextVehicles.forEach((v) => warnMap.set(v.id, { overdue: 0, warning: 0 }));

        if (!overdueResult.error) {
          (overdueResult.data ?? []).forEach((row: { vehicle_id: string }) => {
            const w = warnMap.get(row.vehicle_id);
            if (w) w.overdue += 1;
          });
        }

        if (!warningResult.error) {
          const thirtyDaysLater = new Date();
          thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 60);
          const cutoff = thirtyDaysLater.toISOString().split('T')[0];
          (warningResult.data ?? []).forEach((row: { vehicle_id: string; next_due_date: string }) => {
            if (row.next_due_date <= cutoff) {
              const w = warnMap.get(row.vehicle_id);
              if (w) w.warning += 1;
            }
          });
        }

        setMaintenanceWarnings(warnMap);
      }

      if (!vehiclesResult.error) {
        const countEntries = await Promise.all(
          nextVehicles.map(async (vehicle) => {
            const [totalResult, completedResult, activeResult] = await Promise.all([
              withTimeout(
                supabase
                  .from('trips')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicle.id),
                '차량별 전체 운행 수'
              ),
              withTimeout(
                supabase
                  .from('trips')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicle.id)
                  .eq('status', 'completed'),
                '차량별 완료 운행 수'
              ),
              withTimeout(
                supabase
                  .from('trips')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicle.id)
                  .eq('status', 'in_progress'),
                '차량별 미종료 운행 수'
              ),
            ]);

            const countError = totalResult.error ?? completedResult.error ?? activeResult.error;
            if (countError) {
              throw countError;
            }

            return [
              vehicle.id,
              {
                active: activeResult.count ?? 0,
                completed: completedResult.count ?? 0,
                total: totalResult.count ?? 0,
              },
            ] as const;
          })
        );

        setExactTripCountsByVehicleId(new Map(countEntries));
      }
    } catch (error) {
      setVehicles([]);
      setTrips([]);
      setExactTripCountsByVehicleId(new Map());
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
        <RefreshControl refreshing={isRefreshing} onRefresh={() => loadVehicles(true)} />
      }>
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
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                numberOfLines={1}
                style={[styles.filterText, isSelected && styles.activeFilterText]}>
                {label}
              </Text>
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
          const counts = exactTripCountsByVehicleId.get(vehicle.id) ?? {
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
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    numberOfLines={1}
                    style={styles.vehicleNumber}>
                    {vehicle.vehicle_number}
                  </Text>
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
                  {(() => {
                    const warn = maintenanceWarnings.get(vehicle.id);
                    const hasOverdue = (warn?.overdue ?? 0) > 0;
                    const hasWarning = !hasOverdue && (warn?.warning ?? 0) > 0;
                    return (
                      <Link
                        href={{ pathname: '/vehicles/[id]', params: { id: vehicle.id } }}
                        asChild>
                        <TouchableOpacity
                          accessibilityLabel={`${vehicle.vehicle_number} 정비 현황`}
                          style={[
                            styles.actionBtn,
                            styles.maintenanceBtn,
                            hasOverdue && styles.maintenanceBtnOverdue,
                            hasWarning && styles.maintenanceBtnWarning,
                          ]}>
                          <Text
                            style={[
                              styles.actionText,
                              styles.maintenanceText,
                              hasOverdue && styles.maintenanceTextOverdue,
                              hasWarning && styles.maintenanceTextWarning,
                            ]}>
                            정비{hasOverdue ? ` ·${warn!.overdue}` : hasWarning ? ` ·${warn!.warning}` : ''}
                          </Text>
                        </TouchableOpacity>
                      </Link>
                    );
                  })()}
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
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  managePanel: {
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
  formRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    minWidth: 180,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  editInput: {
    marginRight: 12,
  },
  compactBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 72,
    paddingHorizontal: 14,
  },
  compactBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  countText: {
    color: '#64748B',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    marginRight: 12,
    minWidth: 180,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 16,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryWideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexBasis: '100%',
    padding: 16,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
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
  sectionTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
  },
  reloadText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '500',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  searchPanel: {
    marginBottom: 14,
  },
  filterPanelTitle: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
  },
  filterBar: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 14,
    padding: 4,
  },
  filterBtn: {
    alignItems: 'center',
    borderRadius: 9,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  activeFilterBtn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 1,
  },
  filterText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 15,
    textAlign: 'center',
  },
  activeFilterText: {
    color: '#2563EB',
    fontWeight: '600',
  },
  list: {
    gap: 12,
  },
  vehicleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  vehicleNumber: {
    color: '#0F172A',
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
    minWidth: 0,
  },
  statusBadge: {
    backgroundColor: '#FFFBEB',
    borderRadius: 20,
    color: '#D97706',
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
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 28,
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
  staleBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  staleText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
  },
  warningInlineBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  warningInlineText: {
    color: '#D97706',
    fontSize: 13,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
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
    backgroundColor: '#EFF6FF',
  },
  dangerBtn: {
    backgroundColor: '#FEF2F2',
  },
  maintenanceBtn: {
    backgroundColor: '#F0FDF4',
  },
  maintenanceBtnOverdue: {
    backgroundColor: '#FEF2F2',
  },
  maintenanceBtnWarning: {
    backgroundColor: '#FFFBEB',
  },
  maintenanceText: {
    color: '#16A34A',
  },
  maintenanceTextOverdue: {
    color: '#DC2626',
  },
  maintenanceTextWarning: {
    color: '#D97706',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#2563EB',
  },
  dangerText: {
    color: '#DC2626',
  },
  disabledBtn: {
    opacity: 0.4,
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
  warningBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  warningText: {
    color: '#D97706',
    fontSize: 14,
    fontWeight: '500',
  },
});
