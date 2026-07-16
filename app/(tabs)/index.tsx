import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
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
    void getStoredRole().then(setRole);
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
      roleLabel={roleLabel}
      onSettings={() => router.push('/mode-settings' as never)}
      actionLabel={isSaving ? '저장 중' : activeTrip ? '운행 종료' : '운행 시작'}
      onAction={handlePrimaryAction}>
      {isLoading ? (
        <LoadingCard label="운행 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : activeTrip ? (
        <SectionCard title="진행 중 운행">
          <Text style={styles.activeTripTitle}>{activeTrip.vehicleNumber}</Text>
          <StatusLine label="경로" value={`${activeTrip.startPlace ?? '-'} → ${activeTrip.endPlace ?? '-'}`} />
          <StatusLine label="시작" value={formatTime(activeTrip.startTime)} />
          <StatusLine label="출발 계기판" value={formatKm(activeTrip.startOdometer)} />
          <StatusLine label="OBD" value={obdLabel} />
          <TextInput
            style={styles.input}
            value={endOdometers[activeTrip.id] ?? ''}
            onChangeText={(value) => setEndOdometers((current) => ({ ...current, [activeTrip.id]: value }))}
            placeholder="도착 계기판 km"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
          />
          <Pressable style={styles.cancelBtnWide} onPress={() => void handleCancelTrip(activeTrip)} disabled={isSaving}>
            <Text style={styles.cancelBtnText}>운행 취소</Text>
          </Pressable>
        </SectionCard>
      ) : (
        <SectionCard title="운행 입력">
          <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicleId} onSelect={setSelectedVehicleId} />
          <StatusLine label="현재 계기판" value={formatKm(selectedCurrentKm)} />
          <StatusLine label="OBD" value={obdLabel} />

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
        </SectionCard>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E7EAF8',
    backgroundColor: '#FAFBFF',
    color: '#24304F',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  twoCol: { flexDirection: 'row', gap: 8, marginTop: 8 },
  halfInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E7EAF8',
    backgroundColor: '#FAFBFF',
    color: '#24304F',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
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
  activeTripTitle: { color: '#24304F', fontSize: 18, fontWeight: '900', marginTop: 8 },
  cancelBtnWide: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#F0F2FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  cancelBtnText: { color: '#52607D', fontSize: 14, fontWeight: '900' },
});
