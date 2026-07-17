import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { saveCurrentGpsPoint } from '@/lib/gps-data';
import {
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  mergeVehicleCurrentKm,
  setVehicleCurrentKm,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import { saveTripObdLog } from '@/lib/obd-data';
import { loadSelectedObdBleDevice, obdBle, type ObdLiveData } from '@/lib/obd-ble';
import {
  cancelManualTrip,
  completeManualTrip,
  fetchActiveTrips,
  fetchLatestVehicleOdometers,
  fetchVehiclesReadOnly,
  startManualTrip,
  type TripSummary,
  type VehicleSummary,
} from '@/lib/readonly-data';
import { getStoredRole, type AppRole } from '@/lib/role';

function formatTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined) return '- km';
  return `${Math.round(value).toLocaleString('ko-KR')} km`;
}

function parseKm(value: string) {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default function TripScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [operatorRank, setOperatorRank] = useState('');
  const [userName, setUserName] = useState('');
  const [userRank, setUserRank] = useState('');
  const [sameUser, setSameUser] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [startPlace, setStartPlace] = useState('본부대');
  const [endPlace, setEndPlace] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [endOdometers, setEndOdometers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maintenanceSnapshot, setMaintenanceSnapshot] = useState<MaintenanceSnapshot>({});
  const [obdLiveData, setObdLiveData] = useState<ObdLiveData | null>(null);
  const [isObdConnected, setIsObdConnected] = useState(false);
  const [savedBleDeviceId, setSavedBleDeviceId] = useState<string | null>(null);
  const [savedBleDeviceName, setSavedBleDeviceName] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);

  const activeTripsRef = useRef<TripSummary[]>([]);
  const obdLiveRef = useRef<ObdLiveData | null>(null);
  const obdSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  activeTripsRef.current = activeTrips;
  obdLiveRef.current = obdLiveData;

  const activeTrip = activeTrips[0] ?? null;
  const selectedCurrentKm = selectedVehicleId
    ? getVehicleMaintenanceState(maintenanceSnapshot, selectedVehicleId).currentKm
    : null;

  const stopObdSaveTimer = useCallback(() => {
    if (obdSaveTimerRef.current !== null) {
      clearInterval(obdSaveTimerRef.current);
      obdSaveTimerRef.current = null;
    }
  }, []);

  const stopGpsTimer = useCallback(() => {
    if (gpsTimerRef.current !== null) {
      clearInterval(gpsTimerRef.current);
      gpsTimerRef.current = null;
    }
  }, []);

  const startObdSaveTimer = useCallback(() => {
    stopObdSaveTimer();
    obdSaveTimerRef.current = setInterval(() => {
      const live = obdLiveRef.current;
      if (!live || activeTripsRef.current.length === 0) return;
      for (const trip of activeTripsRef.current) {
        if (trip.vehicleId) void saveTripObdLog(trip.vehicleId, trip.id, live);
      }
    }, 30_000);
  }, [stopObdSaveTimer]);

  const startGpsTimer = useCallback(() => {
    stopGpsTimer();
    gpsTimerRef.current = setInterval(() => {
      for (const trip of activeTripsRef.current) void saveCurrentGpsPoint(trip.id);
    }, 60_000);
  }, [stopGpsTimer]);

  useEffect(() => {
    obdBle.setCallbacks({
      onData: (data: ObdLiveData) => {
        setObdLiveData(data);
        setIsObdConnected(true);
      },
      onStatus: () => {},
      onDisconnect: () => {
        setObdLiveData(null);
        setIsObdConnected(false);
        stopObdSaveTimer();
      },
    });

    return () => {
      obdBle.stopPolling();
      void obdBle.disconnect();
      stopObdSaveTimer();
      stopGpsTimer();
    };
  }, [stopGpsTimer, stopObdSaveTimer]);

  useEffect(() => {
    void loadSelectedObdBleDevice().then((device) => {
      if (device) {
        setSavedBleDeviceId(device.id);
        setSavedBleDeviceName(device.name);
      }
    });
    void getStoredRole().then((nextRole) => {
      setRole(nextRole);
      if (nextRole === 'commander') router.replace('/(tabs)/explore');
    });
  }, []);

  useEffect(() => {
    if (sameUser) {
      setUserRank(operatorRank);
      setUserName(operatorName);
    }
  }, [operatorName, operatorRank, sameUser]);

  useEffect(() => {
    if (!activeTrip && selectedCurrentKm !== null && !startOdometer.trim()) {
      setStartOdometer(String(Math.round(selectedCurrentKm)));
    }
  }, [activeTrip, selectedCurrentKm, startOdometer]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextVehicles, nextActiveTrips] = await Promise.all([fetchVehiclesReadOnly(200), fetchActiveTrips(20)]);
      const vehicleIds = nextVehicles.map((vehicle) => vehicle.id);
      const maintenance = await loadSyncedMaintenanceSnapshot(vehicleIds);
      const latestOdometers = await fetchLatestVehicleOdometers(vehicleIds);
      const nextMaintenanceSnapshot = await mergeVehicleCurrentKm(maintenance.snapshot, latestOdometers);
      setVehicles(nextVehicles);
      setActiveTrips(nextActiveTrips);
      setMaintenanceSnapshot(nextMaintenanceSnapshot);
      setSelectedVehicleId((current) => current ?? nextVehicles[0]?.id ?? null);
      if (nextActiveTrips.length > 0) startGpsTimer();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '운행 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [startGpsTimer]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleStartTrip() {
    if (!selectedVehicleId) {
      Alert.alert('차량 선택 필요', '운행을 시작할 차량을 선택해 주세요.');
      return;
    }
    if (!startPlace.trim() || !endPlace.trim()) {
      Alert.alert('입력 필요', '출발지와 목적지를 입력해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const trip = await startManualTrip({
        vehicleId: selectedVehicleId,
        startPlace,
        endPlace,
        purpose,
        operatorName,
        operatorRank,
        userName: sameUser ? operatorName : userName,
        userRank: sameUser ? operatorRank : userRank,
        startOdometer: parseKm(startOdometer) ?? selectedCurrentKm ?? undefined,
      });
      setActiveTrips([trip]);
      setPurpose('');
      setEndPlace('');

      if (savedBleDeviceId && !isObdConnected) {
        void obdBle.connect(savedBleDeviceId).then((result) => {
          if (result.ok) {
            setIsObdConnected(true);
            obdBle.startPolling(2000);
            startObdSaveTimer();
          }
        });
      }

      const gpsResult = await saveCurrentGpsPoint(trip.id);
      startGpsTimer();
      Alert.alert('운행 시작', `${trip.vehicleNumber} 운행을 시작했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 시작 실패', error instanceof Error ? error.message : '운행을 시작하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelTrip(trip: TripSummary) {
    setIsSaving(true);
    try {
      await cancelManualTrip(trip.id);
      setActiveTrips([]);
      setEndOdometers({});
      stopGpsTimer();
    } catch (error) {
      Alert.alert('취소 실패', error instanceof Error ? error.message : '운행을 취소하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteTrip(trip: TripSummary) {
    const finalEndPlace = endPlace.trim() || trip.endPlace || '목적지 미입력';
    const endOdo = parseKm(endOdometers[trip.id] ?? '');
    const startOdo = trip.startOdometer ?? parseKm(startOdometer);
    setIsSaving(true);
    try {
      if (isObdConnected && obdLiveData && trip.vehicleId) await saveTripObdLog(trip.vehicleId, trip.id, obdLiveData);
      await completeManualTrip(trip.id, finalEndPlace, endOdo, startOdo);
      if (trip.vehicleId && endOdo !== undefined) {
        const nextSnapshot = await setVehicleCurrentKm(trip.vehicleId, endOdo);
        setMaintenanceSnapshot(nextSnapshot);
      }
      const gpsResult = await saveCurrentGpsPoint(trip.id);
      setActiveTrips([]);
      setPurpose('');
      setEndPlace('');
      setStartOdometer('');
      setEndOdometers({});
      obdBle.stopPolling();
      void obdBle.disconnect();
      stopObdSaveTimer();
      stopGpsTimer();
      setIsObdConnected(false);
      setObdLiveData(null);
      Alert.alert('운행 종료', `${trip.vehicleNumber} 운행을 종료했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 종료 실패', error instanceof Error ? error.message : '운행을 종료하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  function handlePrimaryAction() {
    if (activeTrip) void handleCompleteTrip(activeTrip);
    else void handleStartTrip();
  }

  const obdLabel = isObdConnected
    ? `연결됨 · ${obdLiveData?.speedKmh ?? '-'}km/h · 연료 ${obdLiveData?.fuelPercent ?? '-'}%`
    : savedBleDeviceName
      ? `${savedBleDeviceName} 자동연결 대기`
      : '미연결';

  const roleLabel = role === 'commander' ? '수송부' : role === 'driver' ? '운전자' : undefined;

  return (
    <RebuildScreen
      title="운행"
      roleLabel={roleLabel}>
      {isLoading ? (
        <LoadingCard label="운행 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : activeTrip ? (
        <View style={styles.tripCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.kicker}>운행 중</Text>
              <Text style={styles.activeTitle}>{activeTrip.vehicleNumber}</Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          </View>
          <View style={styles.routePanel}>
            <Text style={styles.routePoint}>{activeTrip.startPlace ?? '-'}</Text>
            <Text style={styles.routeArrow}>→</Text>
            <Text style={styles.routePoint}>{activeTrip.endPlace ?? '-'}</Text>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>시작</Text>
              <Text style={styles.statValue}>{formatTime(activeTrip.startTime)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>출발 km</Text>
              <Text style={styles.statValue}>{formatKm(activeTrip.startOdometer)}</Text>
            </View>
          </View>
          <View style={styles.obdStrip}>
            <Text style={styles.obdStripLabel}>OBD</Text>
            <Text style={styles.obdStripValue}>{obdLabel}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={endOdometers[activeTrip.id] ?? ''}
            onChangeText={(value) => setEndOdometers((current) => ({ ...current, [activeTrip.id]: value }))}
            placeholder="도착 계기판 km"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
          />
          <View style={styles.actionRow}>
            <Pressable style={styles.cancelBtnWide} onPress={() => void handleCancelTrip(activeTrip)} disabled={isSaving}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </Pressable>
            <Pressable style={styles.endBtn} onPress={handlePrimaryAction} disabled={isSaving}>
              <Text style={styles.endBtnText}>{isSaving ? '저장 중' : '운행 종료'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
        <View style={styles.heroCard}>
          <View>
            <Text style={styles.kicker}>오늘 운행</Text>
            <Text style={styles.heroTitle}>출발 준비</Text>
            <Text style={styles.heroDesc}>차량과 인원을 확인한 뒤 운행을 시작하세요.</Text>
          </View>
          <View style={styles.heroIconBox}>
            <Text style={styles.heroIcon}>▶</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>계기판</Text>
            <Text style={styles.summaryValue}>{formatKm(selectedCurrentKm)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>OBD</Text>
            <Text style={styles.summaryValue}>{isObdConnected ? '연결' : '대기'}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>차량</Text>
          <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicleId} onSelect={setSelectedVehicleId} />
          <View style={styles.obdStrip}>
            <Text style={styles.obdStripLabel}>OBD</Text>
            <Text style={styles.obdStripValue}>{obdLabel}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>인원</Text>
          <View style={styles.twoCol}>
            <TextInput style={styles.halfInput} value={operatorRank} onChangeText={setOperatorRank} placeholder="운행자 계급" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.halfInput} value={operatorName} onChangeText={setOperatorName} placeholder="운행자 성명" placeholderTextColor="#94A3B8" />
          </View>

          <Pressable style={styles.checkRow} onPress={() => setSameUser((current) => !current)}>
            <View style={[styles.checkbox, sameUser && styles.checkboxOn]}>
              <Text style={styles.checkboxText}>{sameUser ? '✓' : ''}</Text>
            </View>
            <Text style={styles.checkText}>사용자도 운행자와 동일</Text>
          </Pressable>

          <View style={styles.twoCol}>
            <TextInput
              style={styles.halfInput}
              value={userRank}
              onChangeText={setUserRank}
              placeholder="사용자 계급"
              placeholderTextColor="#94A3B8"
              editable={!sameUser}
            />
            <TextInput
              style={styles.halfInput}
              value={userName}
              onChangeText={setUserName}
              placeholder="사용자 성명"
              placeholderTextColor="#94A3B8"
              editable={!sameUser}
            />
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>운행 정보</Text>
          <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="운행 목적" placeholderTextColor="#94A3B8" />
          <View style={styles.twoCol}>
            <TextInput style={styles.halfInput} value={startPlace} onChangeText={setStartPlace} placeholder="출발지" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.halfInput} value={endPlace} onChangeText={setEndPlace} placeholder="목적지" placeholderTextColor="#94A3B8" />
          </View>
          <TextInput
            style={styles.input}
            value={startOdometer}
            onChangeText={setStartOdometer}
            placeholder="출발 계기판 km"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
          />
        </View>

        <Pressable style={styles.startBtn} onPress={handlePrimaryAction} disabled={isSaving}>
          <Text style={styles.startBtnText}>{isSaving ? '저장 중' : '운행 시작'}</Text>
        </Pressable>
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    minHeight: 128,
    borderRadius: 26,
    backgroundColor: '#1D2B5C',
    padding: 20,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#7180A3',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  kicker: { color: '#94A3B8', fontSize: 12, fontWeight: '900', marginBottom: 5 },
  heroTitle: { color: '#FFFFFF', fontSize: 27, fontWeight: '900' },
  activeTitle: { color: '#1E2946', fontSize: 27, fontWeight: '900' },
  heroDesc: { color: '#DDE6FF', fontSize: 13, fontWeight: '700', marginTop: 8, lineHeight: 19 },
  heroIconBox: {
    width: 54,
    height: 54,
    borderRadius: 20,
    backgroundColor: '#EDF4FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIcon: { color: '#4F6AE6', fontSize: 24, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryCard: {
    flex: 1,
    minHeight: 78,
    borderRadius: 20,
    backgroundColor: '#FFFDFB',
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 14,
  },
  summaryLabel: { color: '#7B86A8', fontSize: 12, fontWeight: '900', marginBottom: 6 },
  summaryValue: { color: '#1E2946', fontSize: 19, fontWeight: '900' },
  formCard: {
    backgroundColor: '#FFFDFB',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 14,
    marginBottom: 10,
    shadowColor: '#B0B8D8',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  formTitle: { color: '#1E2946', fontSize: 15, fontWeight: '900', marginBottom: 10 },
  tripCard: {
    borderRadius: 26,
    backgroundColor: '#FFFDFB',
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 18,
    marginBottom: 10,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ECFDF3',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A' },
  liveBadgeText: { color: '#047857', fontSize: 11, fontWeight: '900' },
  routePanel: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: '#F6F8FE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  routePoint: { color: '#1E2946', fontSize: 15, fontWeight: '900', flex: 1 },
  routeArrow: { color: '#7B86A8', fontSize: 18, fontWeight: '900', marginHorizontal: 10 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: { flex: 1, borderRadius: 16, backgroundColor: '#F6F8FE', padding: 12 },
  statLabel: { color: '#7B86A8', fontSize: 11, fontWeight: '900', marginBottom: 5 },
  statValue: { color: '#1E2946', fontSize: 13, fontWeight: '900' },
  obdStrip: {
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#EFF6FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  obdStripLabel: { color: '#52607D', fontSize: 12, fontWeight: '900' },
  obdStripValue: { color: '#1D4ED8', fontSize: 12, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  input: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E7EAF8',
    backgroundColor: '#FAFBFF',
    color: '#24304F',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
    marginTop: 7,
  },
  twoCol: { flexDirection: 'row', gap: 8, marginTop: 7 },
  halfInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E7EAF8',
    backgroundColor: '#FAFBFF',
    color: '#24304F',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#5B7CFA', borderColor: '#5B7CFA' },
  checkboxText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  checkText: { color: '#52607D', fontSize: 13, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancelBtnWide: {
    flex: 0.7,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#F0F2FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  cancelBtnText: { color: '#52607D', fontSize: 14, fontWeight: '900' },
  endBtn: {
    flex: 1.4,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#128A7A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  endBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  startBtn: {
    minHeight: 56,
    borderRadius: 19,
    backgroundColor: '#4F6AE6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8FA3FF',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
    marginTop: 2,
  },
  startBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
