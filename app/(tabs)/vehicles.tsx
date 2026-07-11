import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { getStoredUnitCode } from '../../lib/unit';
import { formatDateTime, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type Vehicle = {
  id: string;
  vehicle_number: string;
  equipment_name: string | null;
  equipment_number: string | null;
  fuel_type: string | null;
  color: string | null;
  current_odometer: number | null;
  oil_changed_km: number | null;
  oil_filter_changed_km: number | null;
  air_filter_changed_km: number | null;
  obd_device_id: string | null;
  obd_ios_device_id: string | null;
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

type ObdLogEntry = {
  coolant_temp_c: number | null;
  battery_voltage: number | null;
  rpm: number | null;
  fuel_level_percent: number | null;
  intake_air_temp_c: number | null;
  engine_load_percent: number | null;
  dtc_codes: string[] | null;
  recorded_at: string | null;
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
  const [statusFilter, setStatusFilter] = useState<VehicleStatusFilter>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedTabVehicleId, setSelectedTabVehicleId] = useState<string | null>(null);
  const [newEquipmentName, setNewEquipmentName] = useState('');
  const [newEquipmentNumber, setNewEquipmentNumber] = useState('');
  const [newFuelType, setNewFuelType] = useState('');
  const [newInitialOdometer, setNewInitialOdometer] = useState('');
  const [showFuelTypeModal, setShowFuelTypeModal] = useState(false);
  const [showVehicleSelectorModal, setShowVehicleSelectorModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [latestObdByVehicleId, setLatestObdByVehicleId] = useState<Map<string, ObdLogEntry | null>>(new Map());

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

  const fleetAlerts = useMemo(() => {
    const INTERVALS = { oil: 5000, oilFilter: 10000, airFilter: 15000 };
    const alerts: { vehicleId: string; vehicleNumber: string; item: string; remainingKm: number; level: 'critical' | 'warning' | 'ok' }[] = [];

    vehicles.forEach((vehicle) => {
      const odometer = vehicle.current_odometer ?? 0;
      [
        { item: '엔진오일', changedAt: vehicle.oil_changed_km ?? 0, interval: INTERVALS.oil },
        { item: '오일필터', changedAt: vehicle.oil_filter_changed_km ?? 0, interval: INTERVALS.oilFilter },
        { item: '에어필터', changedAt: vehicle.air_filter_changed_km ?? 0, interval: INTERVALS.airFilter },
      ].forEach(({ item, changedAt, interval }) => {
        const remainingKm = interval - (odometer - changedAt);
        alerts.push({
          vehicleId: vehicle.id,
          vehicleNumber: vehicle.vehicle_number,
          item,
          remainingKm,
          level: remainingKm <= 500 ? 'critical' : remainingKm <= 2000 ? 'warning' : 'ok',
        });
      });
    });

    return alerts.sort((a, b) => a.remainingKm - b.remainingKm);
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => {
      const activeTrip = activeTripsByVehicleId.get(vehicle.id) ?? null;
      const isStale = isStaleActiveTrip(activeTrip?.start_time ?? null);
      return (
        statusFilter === 'all' ||
        (statusFilter === 'active' && activeTrip) ||
        (statusFilter === 'waiting' && !activeTrip) ||
        (statusFilter === 'stale' && isStale)
      );
    });
  }, [activeTripsByVehicleId, statusFilter, vehicles]);

  const selectedTabVehicle = useMemo(() => {
    return filteredVehicles.find((v) => v.id === selectedTabVehicleId) ?? filteredVehicles[0] ?? null;
  }, [filteredVehicles, selectedTabVehicleId]);

  const selectedVehicleDetail = useMemo(() => {
    if (!selectedTabVehicle) return null;
    const activeTrip = activeTripsByVehicleId.get(selectedTabVehicle.id) ?? null;
    const latestTrip = latestTripsByVehicleId.get(selectedTabVehicle.id) ?? null;
    const counts = exactTripCountsByVehicleId.get(selectedTabVehicle.id) ?? { total: 0, completed: 0, active: 0 };
    const isStale = isStaleActiveTrip(activeTrip?.start_time ?? null);
    const canDelete = counts.total === 0 && !activeTrip;
    return { activeTrip, latestTrip, counts, isStale, canDelete };
  }, [selectedTabVehicle, activeTripsByVehicleId, latestTripsByVehicleId, exactTripCountsByVehicleId]);

  const loadVehicles = useCallback(async (refreshing = false) => {
    if (refreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setErrorMessage(null);

    try {
      const unitCode = await getStoredUnitCode();
      const vehicleQuery = supabase.from('vehicles').select('id, vehicle_number, equipment_name, equipment_number, fuel_type, color, current_odometer, oil_changed_km, oil_filter_changed_km, air_filter_changed_km, obd_device_id, obd_ios_device_id').order('vehicle_number');
      if (unitCode) vehicleQuery.eq('unit_code', unitCode);

      const [vehiclesResult, tripsResult] = await Promise.all([
        withTimeout(vehicleQuery, '차량 목록'),
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

        const obdEntries = await Promise.all(
          nextVehicles.map(async (vehicle) => {
            const { data } = await supabase
              .from('obd_logs')
              .select('coolant_temp_c, battery_voltage, rpm, fuel_level_percent, intake_air_temp_c, engine_load_percent, dtc_codes, recorded_at')
              .eq('vehicle_id', vehicle.id)
              .order('recorded_at', { ascending: false })
              .limit(1);
            return [vehicle.id, data?.[0] ?? null] as const;
          })
        );
        setLatestObdByVehicleId(new Map(obdEntries));
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
      const parsedOdometer = newInitialOdometer.trim() ? parseFloat(newInitialOdometer.replace(/,/g, '')) : null;
      const { error } = await withTimeout(
        supabase.from('vehicles').insert({
          vehicle_number: vehicleNumber,
          equipment_name: newEquipmentName.trim() || null,
          equipment_number: newEquipmentNumber.trim() || null,
          fuel_type: newFuelType.trim() || null,
          current_odometer: !isNaN(parsedOdometer as number) ? parsedOdometer : null,
        }),
        '차량 등록'
      );

      if (error) {
        setErrorMessage(formatDbError(error, '차량 등록 중 오류가 발생했습니다.'));
        return;
      }

      setNewVehicleNumber('');
      setNewEquipmentName('');
      setNewEquipmentNumber('');
      setNewFuelType('');
      setNewInitialOdometer('');
      setShowRegisterModal(false);
      await loadVehicles(true);
    } catch (error) {
      setErrorMessage(formatDbError(error, '차량 등록 중 오류가 발생했습니다.'));
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, loadVehicles, newEquipmentName, newEquipmentNumber, newFuelType, newInitialOdometer, newVehicleNumber, vehicles]);

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

  const handleMaintenanceComplete = useCallback(
    async (vehicleId: string, field: 'oil_changed_km' | 'oil_filter_changed_km' | 'air_filter_changed_km', currentKm: number | null) => {
      if (currentKm == null) {
        Alert.alert('오도미터 없음', '현재 오도미터가 설정되지 않았습니다. 운행 후 자동으로 설정됩니다.');
        return;
      }
      Alert.alert(
        '교환 완료 기록',
        `현재 오도미터 ${currentKm.toLocaleString()} km 기준으로\n교환 완료를 기록합니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '저장',
            onPress: async () => {
              setIsSaving(true);
              setErrorMessage(null);
              try {
                const { error } = await withTimeout(
                  supabase.from('vehicles').update({ [field]: currentKm }).eq('id', vehicleId),
                  '정비 기록 저장'
                );
                if (error) {
                  setErrorMessage(formatDbError(error, '정비 기록 저장 중 오류가 발생했습니다.'));
                } else {
                  await loadVehicles(true);
                }
              } catch (err) {
                setErrorMessage(formatDbError(err, '정비 기록 저장 중 오류가 발생했습니다.'));
              } finally {
                setIsSaving(false);
              }
            },
          },
        ]
      );
    },
    [loadVehicles]
  );

  const handleClearObdDevice = useCallback(
    (vehicle: Vehicle, platform: 'android' | 'ios') => {
      const column = platform === 'android' ? 'obd_device_id' : 'obd_ios_device_id';
      const currentId = platform === 'android' ? vehicle.obd_device_id : vehicle.obd_ios_device_id;
      const platformLabel = platform === 'android' ? 'Android' : 'iOS';
      Alert.alert(
        `OBD 단말기 변경 (${platformLabel})`,
        `${currentId ? `현재 등록: …${currentId.slice(-8)}\n\n` : ''}${platformLabel} 단말기 등록을 해제합니다.\n\n해제 후 운행 탭에서 OBD를 검색하여 연결하면 자동으로 재등록됩니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '해제',
            style: 'destructive',
            onPress: async () => {
              setIsSaving(true);
              setErrorMessage(null);
              try {
                const { error } = await withTimeout(
                  supabase.from('vehicles').update({ [column]: null }).eq('id', vehicle.id),
                  'OBD 단말기 해제'
                );
                if (error) {
                  setErrorMessage(formatDbError(error, 'OBD 단말기 해제 중 오류가 발생했습니다.'));
                } else {
                  await loadVehicles(true);
                }
              } catch (err) {
                setErrorMessage(formatDbError(err, 'OBD 단말기 해제 중 오류가 발생했습니다.'));
              } finally {
                setIsSaving(false);
              }
            },
          },
        ]
      );
    },
    [loadVehicles]
  );

  useFocusEffect(
    useCallback(() => {
      loadVehicles();
    }, [loadVehicles])
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
        <RefreshControl refreshing={isRefreshing} onRefresh={() => loadVehicles(true)} />
      }>
      <View style={styles.titleRow}>
        <Text style={styles.title}>차량 진단</Text>
        <TouchableOpacity
          style={styles.registerBtn}
          onPress={() => setShowRegisterModal(true)}>
          <Text style={styles.registerBtnText}>+ 차량등록</Text>
        </TouchableOpacity>
      </View>

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

      {vehicles.length > 0 && (
        <View style={styles.alertsCard}>
          <Text style={styles.alertsTitle}>소모품 교환주기 현황</Text>
          {fleetAlerts.map((alert) => (
            <TouchableOpacity
              key={`${alert.vehicleId}-${alert.item}`}
              style={[styles.alertRow, alert.level === 'critical' && styles.alertRowCritical]}
              onPress={() => setSelectedTabVehicleId(alert.vehicleId)}>
              <View style={[
                styles.alertDot,
                alert.level === 'critical' ? styles.alertDotCritical : alert.level === 'warning' ? styles.alertDotWarning : styles.alertDotOk,
              ]} />
              <Text style={styles.alertText}>{alert.vehicleNumber} · {alert.item}</Text>
              <Text style={[
                styles.alertKm,
                alert.level === 'critical' && styles.alertKmCritical,
                alert.level === 'ok' && styles.alertKmOk,
              ]}>
                {alert.remainingKm <= 0 ? '교환 필요' : `${Math.round(alert.remainingKm)}km`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

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
          <ActivityIndicator color="#2563EB" />
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

      {filteredVehicles.length > 0 && (
        <TouchableOpacity style={styles.vehicleDropdownBtn} onPress={() => setShowVehicleSelectorModal(true)}>
          <View style={{ flex: 1 }}>
            {selectedTabVehicle ? (
              <>
                <Text style={styles.vehicleDropdownText}>{selectedTabVehicle.vehicle_number}</Text>
                {selectedTabVehicle.equipment_name ? (
                  <Text style={styles.vehicleDropdownSub}>{selectedTabVehicle.equipment_name}</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.vehicleDropdownPlaceholder}>차량 선택</Text>
            )}
          </View>
          {selectedTabVehicle && activeTripsByVehicleId.has(selectedTabVehicle.id) && (
            <View style={[styles.tabDotInline, isStaleActiveTrip(activeTripsByVehicleId.get(selectedTabVehicle.id)?.start_time ?? null) && styles.tabDotStaleInline]} />
          )}
          <Text style={styles.dropdownArrow}>▾</Text>
        </TouchableOpacity>
      )}

      {selectedTabVehicle && selectedVehicleDetail && (
        (({ vehicle, activeTrip, latestTrip, counts, isStale, canDelete }) => {
          const statusText = activeTrip ? '운행 중' : '대기 중';
          const latestObd = latestObdByVehicleId.get(vehicle.id) ?? null;
          return (
            <View style={styles.vehicleCard}>
              <View style={styles.obdStatusCard}>
                <View style={styles.obdIconBox}>
                  <Text style={styles.obdIconText}>▣</Text>
                </View>
                <View style={styles.obdStatusCopy}>
                  <Text style={styles.obdStatusTitle}>
                    {latestObd ? 'OBD 스캐너 연결됨' : 'OBD 스캐너 대기'}
                  </Text>
                  <Text style={styles.obdStatusSub}>ELM327 · Bluetooth</Text>
                </View>
                <View style={[styles.obdStateBadge, !latestObd && styles.obdStateBadgeIdle]}>
                  <Text style={[styles.obdStateText, !latestObd && styles.obdStateTextIdle]}>
                    {latestObd ? '● 연결됨' : '대기'}
                  </Text>
                </View>
              </View>

              <Text style={styles.ecuSectionLabel}>ECU 실시간 데이터</Text>
              <View style={styles.obdGrid}>
                {([
                  ['냉각수 온도', latestObd?.coolant_temp_c != null ? `${latestObd.coolant_temp_c}` : '--', '°C'],
                  ['배터리 전압', latestObd?.battery_voltage != null ? latestObd.battery_voltage.toFixed(1) : '--', 'V'],
                  ['엔진 회전수', latestObd?.rpm != null ? latestObd.rpm.toLocaleString() : '--', 'rpm'],
                  ['연료 잔량', latestObd?.fuel_level_percent != null ? `${latestObd.fuel_level_percent}` : '--', '%'],
                  ['흡기 온도', latestObd?.intake_air_temp_c != null ? `${latestObd.intake_air_temp_c}` : '--', '°C'],
                  ['엔진 부하', latestObd?.engine_load_percent != null ? `${latestObd.engine_load_percent}` : '--', '%'],
                ] as [string, string, string][]).map(([label, value, unit]) => (
                  <View key={label} style={styles.obdCell}>
                    <Text style={styles.obdCellLabel}>{label}</Text>
                    <Text style={styles.obdCellValue}>{value}</Text>
                    <Text style={styles.obdCellUnit}>{unit}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.dtcRow}>
                <Text style={styles.dtcLabel}>● 고장 코드 (DTC)</Text>
                {latestObd?.dtc_codes && latestObd.dtc_codes.length > 0 ? (
                  <Text style={styles.dtcError}>{latestObd.dtc_codes.join(', ')}</Text>
                ) : (
                  <Text style={styles.dtcOk}>정상 · 코드 없음</Text>
                )}
              </View>

              <View style={styles.vehicleInfoPanel}>
                <Text style={styles.subSectionTitle}>차량 정보</Text>
                {vehicle.equipment_name ? <InfoRow label="장비명" value={vehicle.equipment_name} /> : null}
                {vehicle.equipment_number ? <InfoRow label="장비 호수" value={vehicle.equipment_number} /> : null}
                {vehicle.fuel_type ? <InfoRow label="사용 유류" value={vehicle.fuel_type} /> : null}
                <InfoRow label="현재 오도미터" value={vehicle.current_odometer != null ? `${vehicle.current_odometer.toLocaleString()} km` : '미설정'} />
                <InfoRow label="운행 상태" value={isStale ? '장시간 운행' : statusText} />
                <InfoRow label="전체 운행" value={`${counts.total}건`} />
                <InfoRow label="최근 출발" value={formatDateTime(latestTrip?.start_time ?? null)} />
                <InfoRow label="최근 종료" value={formatDateTime(latestTrip?.end_time ?? null)} />
                <View style={styles.obdPairingRow}>
                  <View style={styles.obdPairingInfo}>
                    <Text style={styles.infoLabel}>OBD (Android)</Text>
                    <Text style={[styles.infoValue, !vehicle.obd_device_id && styles.obdPairingNone]}>
                      {vehicle.obd_device_id ? `…${vehicle.obd_device_id.slice(-8)}` : '미등록'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.obdPairingBtn, vehicle.obd_device_id && styles.obdPairingBtnRegistered]}
                    onPress={() => handleClearObdDevice(vehicle, 'android')}
                    disabled={isSaving}>
                    <Text style={[styles.obdPairingBtnText, vehicle.obd_device_id && styles.obdPairingBtnTextRegistered]}>
                      {vehicle.obd_device_id ? '변경' : '미등록'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.obdPairingRow}>
                  <View style={styles.obdPairingInfo}>
                    <Text style={styles.infoLabel}>OBD (iOS)</Text>
                    <Text style={[styles.infoValue, !vehicle.obd_ios_device_id && styles.obdPairingNone]}>
                      {vehicle.obd_ios_device_id ? `…${vehicle.obd_ios_device_id.slice(-8)}` : '미등록'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.obdPairingBtn, vehicle.obd_ios_device_id && styles.obdPairingBtnRegistered]}
                    onPress={() => handleClearObdDevice(vehicle, 'ios')}
                    disabled={isSaving}>
                    <Text style={[styles.obdPairingBtnText, vehicle.obd_ios_device_id && styles.obdPairingBtnTextRegistered]}>
                      {vehicle.obd_ios_device_id ? '변경' : '미등록'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {isStale && (
                  <View style={styles.staleBox}>
                    <Text style={styles.staleText}>8시간 이상 종료되지 않은 운행입니다.</Text>
                  </View>
                )}
                {counts.active > 1 && (
                  <View style={styles.warningInlineBox}>
                    <Text style={styles.warningInlineText}>미종료 운행 {counts.active}건 — 상세 화면에서 확인해 주세요.</Text>
                  </View>
                )}
              </View>

              <View style={styles.maintenanceSection}>
                <Text style={styles.subSectionTitle}>소모품 교환주기</Text>
                {[
                  { label: '엔진오일', changedKm: vehicle.oil_changed_km, interval: 5000, field: 'oil_changed_km' as const },
                  { label: '오일필터', changedKm: vehicle.oil_filter_changed_km, interval: 10000, field: 'oil_filter_changed_km' as const },
                  { label: '에어필터', changedKm: vehicle.air_filter_changed_km, interval: 15000, field: 'air_filter_changed_km' as const },
                ].map(({ label, changedKm, interval, field }) => {
                  const odometer = vehicle.current_odometer ?? 0;
                  const usedKm = odometer - (changedKm ?? 0);
                  const pct = Math.min(Math.max(usedKm / interval, 0), 1);
                  const remainingKm = interval - usedKm;
                  const isWarning = remainingKm <= 2000 && remainingKm > 500;
                  const isCritical = remainingKm <= 500;
                  const noData = changedKm == null && vehicle.current_odometer == null;
                  return (
                    <View key={label} style={styles.maintenanceRow}>
                      <Text style={styles.maintenanceLabel}>{label}</Text>
                      <View style={styles.maintenanceBarTrack}>
                        <View style={[
                          styles.maintenanceBarFill,
                          { width: noData ? '0%' : `${pct * 100}%` },
                          isWarning && { backgroundColor: '#F59E0B' },
                          isCritical && { backgroundColor: '#DC2626' },
                        ]} />
                      </View>
                      <Text style={[
                        styles.maintenanceInfo,
                        isWarning && { color: '#D97706' },
                        isCritical && { color: '#DC2626' },
                      ]}>
                        {noData ? '정보 없음' : remainingKm <= 0 ? '교환 필요' : `${Math.round(remainingKm)}km`}
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.maintenanceDoneBtn,
                          isCritical && styles.maintenanceDoneBtnCritical,
                          isWarning && styles.maintenanceDoneBtnWarning,
                        ]}
                        onPress={() => handleMaintenanceComplete(vehicle.id, field, vehicle.current_odometer)}
                        disabled={isSaving}>
                        <Text style={[
                          styles.maintenanceDoneBtnText,
                          isCritical && styles.maintenanceDoneBtnTextCritical,
                          isWarning && styles.maintenanceDoneBtnTextWarning,
                        ]}>교환 완료</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>

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
                <>
                  <View style={styles.actions}>
                    <TouchableOpacity
                      accessibilityLabel="차량번호 수정"
                      style={[styles.actionBtn, styles.secondaryBtn]}
                      onPress={() => startEditVehicle(vehicle)}>
                      <Text style={[styles.actionText, styles.secondaryText]}>번호 수정</Text>
                    </TouchableOpacity>
                    {canDelete && (
                      <TouchableOpacity
                        accessibilityLabel="차량 삭제"
                        style={[styles.actionBtn, styles.dangerBtn]}
                        onPress={() => handleDeleteVehicle(vehicle)}
                        disabled={isSaving}>
                        <Text style={[styles.actionText, styles.dangerText]}>삭제</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {activeTrip ? (
                    <View style={styles.actions}>
                      <Link href={{ pathname: '/trips/[id]', params: { id: activeTrip.id } }} asChild>
                        <TouchableOpacity accessibilityLabel="운행 상세 보기" style={styles.actionBtn}>
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
                    <Link href={{ pathname: '/trips/[id]', params: { id: latestTrip.id } }} asChild>
                      <TouchableOpacity
                        accessibilityLabel="최근 운행 상세 보기"
                        style={[styles.actionBtn, styles.secondaryBtn, styles.singleAction]}>
                        <Text style={[styles.actionText, styles.secondaryText]}>최근 운행 상세</Text>
                      </TouchableOpacity>
                    </Link>
                  ) : null}
                </>
              )}
            </View>
          );
        })({ vehicle: selectedTabVehicle, ...selectedVehicleDetail })
      )}
      {/* Vehicle register modal */}
      <Modal visible={showRegisterModal} transparent animationType="slide" onRequestClose={() => setShowRegisterModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRegisterModal(false)}>
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>차량 등록</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput
                style={[styles.textInput, { marginBottom: 10 }]}
                value={newVehicleNumber}
                onChangeText={setNewVehicleNumber}
                placeholder="차량번호 입력 (필수)"
                placeholderTextColor="#94A3B8"
              />
              <View style={styles.formRowTwo}>
                <TextInput
                  style={[styles.textInput, { flex: 1, marginRight: 8 }]}
                  value={newEquipmentName}
                  onChangeText={setNewEquipmentName}
                  placeholder="장비명"
                  placeholderTextColor="#94A3B8"
                />
                <TextInput
                  style={[styles.textInput, { flex: 1 }]}
                  value={newEquipmentNumber}
                  onChangeText={setNewEquipmentNumber}
                  placeholder="장비 호수"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <TextInput
                style={[styles.textInput, { marginBottom: 10 }]}
                value={newInitialOdometer}
                onChangeText={setNewInitialOdometer}
                placeholder="초기 오도미터 km (선택)"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
              />
              <TouchableOpacity style={[styles.dropdownBtn, { marginBottom: 10 }]} onPress={() => setShowFuelTypeModal(true)}>
                <Text style={newFuelType ? styles.dropdownBtnText : styles.dropdownPlaceholder}>
                  {newFuelType || '사용 유류 선택'}
                </Text>
                <Text style={styles.dropdownArrow}>▾</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="차량 등록"
                style={[styles.compactBtn, styles.fullWidthBtn, { marginTop: 14, marginBottom: 8 }, (!newVehicleNumber.trim() || isSaving) && styles.disabledBtn]}
                onPress={handleCreateVehicle}
                disabled={!newVehicleNumber.trim() || isSaving}>
                <Text style={styles.compactBtnText}>{isSaving ? '저장 중...' : '등록하기'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Fuel type modal */}
      <Modal visible={showFuelTypeModal} transparent animationType="slide" onRequestClose={() => setShowFuelTypeModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowFuelTypeModal(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>사용 유류 선택</Text>
            {['경유', '휘발유', '등유', '혼합유', 'JP-8'].map((fuel) => (
              <TouchableOpacity
                key={fuel}
                style={[styles.modalItem, newFuelType === fuel && styles.modalItemActive]}
                onPress={() => { setNewFuelType(fuel); setShowFuelTypeModal(false); }}>
                <Text style={[styles.modalItemText, newFuelType === fuel && styles.modalItemTextActive]}>{fuel}</Text>
                {newFuelType === fuel && <Text style={styles.modalCheckmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Vehicle selector modal */}
      <Modal visible={showVehicleSelectorModal} transparent animationType="slide" onRequestClose={() => setShowVehicleSelectorModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowVehicleSelectorModal(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>차량 선택</Text>
            <ScrollView style={styles.modalScroll}>
              {filteredVehicles.map((vehicle) => {
                const isSelected = selectedTabVehicle?.id === vehicle.id;
                const tabActiveTrip = activeTripsByVehicleId.get(vehicle.id) ?? null;
                const tabIsStale = isStaleActiveTrip(tabActiveTrip?.start_time ?? null);
                return (
                  <TouchableOpacity
                    key={vehicle.id}
                    style={[styles.modalItem, isSelected && styles.modalItemActive]}
                    onPress={() => { setSelectedTabVehicleId(vehicle.id); setShowVehicleSelectorModal(false); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>
                        {vehicle.vehicle_number}
                        {tabActiveTrip ? (tabIsStale ? ' ⚠️ 운행 중' : ' 🟢 운행 중') : ''}
                      </Text>
                      {vehicle.equipment_name ? (
                        <Text style={styles.modalItemSub}>{vehicle.equipment_name}{vehicle.fuel_type ? ` · ${vehicle.fuel_type}` : ''}</Text>
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
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  registerBtn: {
    alignItems: 'center',
    backgroundColor: '#0F8F7B',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  registerBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  vehicleChipRow: {
    gap: 8,
    paddingBottom: 14,
  },
  vehicleChip: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    minWidth: 86,
    paddingHorizontal: 14,
  },
  vehicleChipActive: {
    backgroundColor: '#0F8F7B',
    borderColor: '#0F8F7B',
  },
  vehicleChipText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '800',
  },
  vehicleChipTextActive: {
    color: '#FFFFFF',
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
    fontWeight: '700',
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
  summaryWideCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '100%',
    padding: 16,
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
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  activeFilterBtn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
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
    fontWeight: '700',
  },
  list: {
    gap: 12,
  },
  vehicleCard: {
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
  obdStatusCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#ECEAE4',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
    padding: 16,
  },
  obdIconBox: {
    alignItems: 'center',
    backgroundColor: '#E6FAF4',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  obdIconText: {
    color: '#0F8F7B',
    fontSize: 24,
    fontWeight: '900',
  },
  obdStatusCopy: {
    flex: 1,
    minWidth: 0,
  },
  obdStatusTitle: {
    color: '#1C2434',
    fontSize: 16,
    fontWeight: '900',
  },
  obdStatusSub: {
    color: '#8C8F98',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  obdStateBadge: {
    backgroundColor: '#ECFDF3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  obdStateBadgeIdle: {
    backgroundColor: '#F1F5F9',
  },
  obdStateText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '900',
  },
  obdStateTextIdle: {
    color: '#64748B',
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
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    color: '#64748B',
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
    color: '#0F172A',
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
    color: '#B91C1C',
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
    color: '#B45309',
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
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    flexBasis: 132,
    flexGrow: 1,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  singleAction: {
    marginTop: 12,
  },
  secondaryBtn: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
  },
  dangerBtn: {
    backgroundColor: '#FEF2F2',
  },
  maintenanceBtn: {
    backgroundColor: '#ECFDF5',
  },
  maintenanceBtnOverdue: {
    backgroundColor: '#FEF2F2',
  },
  maintenanceBtnWarning: {
    backgroundColor: '#FFFBEB',
  },
  maintenanceText: {
    color: '#059669',
  },
  maintenanceTextOverdue: {
    color: '#DC2626',
  },
  maintenanceTextWarning: {
    color: '#D97706',
  },
  obdBtn: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
  },
  obdText: {
    color: '#B45309',
  },
  actionText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#64748B',
  },
  dangerText: {
    color: '#DC2626',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  // Vehicle tabs
  tabsScroll: {
    marginBottom: 14,
  },
  tabsContent: {
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  vehicleTab: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 80,
  },
  vehicleTabActive: {
    backgroundColor: '#2563EB',
  },
  vehicleTabStale: {
    backgroundColor: '#FEE2E2',
  },
  vehicleTabText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  vehicleTabTextActive: {
    color: '#FFFFFF',
  },
  tabDot: {
    backgroundColor: '#059669',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  tabDotStale: {
    backgroundColor: '#DC2626',
  },
  // Fleet alert card
  alertsCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  alertsTitle: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  alertRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 7,
  },
  alertRowCritical: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    marginHorizontal: -6,
    paddingHorizontal: 6,
  },
  alertDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  alertDotOk: {
    backgroundColor: '#22C55E',
  },
  alertDotWarning: {
    backgroundColor: '#F59E0B',
  },
  alertDotCritical: {
    backgroundColor: '#DC2626',
  },
  alertText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  alertKm: {
    color: '#D97706',
    fontSize: 12,
    fontWeight: '700',
  },
  alertKmOk: {
    color: '#16A34A',
  },
  alertKmCritical: {
    color: '#DC2626',
  },
  // OBD section header with connect link
  obdSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  obdConnectLink: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  obdNoData: {
    paddingVertical: 10,
  },
  obdNoDataText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
  },
  obdRecordedAt: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'right',
  },
  dtcError: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  // OBD section
  obdSection: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  subSectionTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
  },
  ecuSectionLabel: {
    color: '#8C8F98',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  obdGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  obdCell: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECEAE4',
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 84,
    padding: 13,
  },
  obdCellLabel: {
    color: '#8C8F98',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  obdCellValue: {
    color: '#1C2434',
    fontSize: 25,
    fontWeight: '900',
  },
  obdCellUnit: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '400',
    marginTop: 2,
  },
  dtcRow: {
    alignItems: 'center',
    backgroundColor: '#ECFDF3',
    borderRadius: 13,
    borderTopWidth: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  dtcLabel: {
    color: '#15803D',
    fontSize: 14,
    fontWeight: '900',
  },
  dtcOk: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '700',
  },
  vehicleInfoPanel: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 2,
    padding: 14,
  },
  // Maintenance section
  maintenanceSection: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECEAE4',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  maintenanceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  maintenanceLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    width: 64,
  },
  maintenanceBarTrack: {
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  maintenanceBarFill: {
    backgroundColor: '#2563EB',
    borderRadius: 4,
    height: '100%',
  },
  maintenanceInfo: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    width: 54,
    textAlign: 'right',
  },
  maintenanceDoneBtn: {
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 6,
  },
  maintenanceDoneBtnCritical: {
    backgroundColor: '#FEF2F2',
  },
  maintenanceDoneBtnWarning: {
    backgroundColor: '#FFFBEB',
  },
  maintenanceDoneBtnText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '600',
  },
  maintenanceDoneBtnTextCritical: {
    color: '#DC2626',
  },
  maintenanceDoneBtnTextWarning: {
    color: '#D97706',
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
  // Dropdown button for vehicle selector
  vehicleDropdownBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 14,
    minHeight: 56,
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
    fontSize: 16,
    fontWeight: '600',
  },
  vehicleDropdownSub: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  vehicleDropdownPlaceholder: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '500',
  },
  tabDotInline: {
    backgroundColor: '#22C55E',
    borderRadius: 5,
    height: 10,
    marginRight: 8,
    width: 10,
  },
  tabDotStaleInline: {
    backgroundColor: '#F59E0B',
  },
  dropdownArrow: {
    color: '#94A3B8',
    fontSize: 16,
    marginLeft: 8,
  },
  // Registration form extras
  formRowTwo: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  dropdownBtn: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dropdownBtnText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  dropdownPlaceholder: {
    color: '#94A3B8',
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  fullWidthBtn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  // Modal styles
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 32,
    paddingTop: 20,
    paddingHorizontal: 20,
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
  // Color picker
  colorPickerRow: {
    marginBottom: 4,
  },
  colorPickerLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 10,
  },
  colorOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  colorOption: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 2,
    flex: 1,
    paddingVertical: 10,
    gap: 6,
  },
  colorOptionSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  colorSwatch: {
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    height: 30,
    width: 30,
  },
  colorOptionText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  colorOptionTextSelected: {
    color: '#2563EB',
  },
  // OBD pairing row in vehicle info panel
  obdPairingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 36,
    gap: 8,
  },
  obdPairingInfo: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  obdPairingNone: {
    color: '#94A3B8',
  },
  obdPairingBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  obdPairingBtnRegistered: {
    backgroundColor: '#EFF6FF',
    borderColor: '#DBEAFE',
    borderWidth: 1,
  },
  obdPairingBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  obdPairingBtnTextRegistered: {
    color: '#2563EB',
  },
  // Color in vehicle detail
  colorInfoValue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  colorSwatchSmall: {
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    height: 16,
    width: 16,
  },
});
