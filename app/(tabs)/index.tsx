import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { saveCurrentGpsPoint } from '@/lib/gps-data';
import {
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  setVehicleCurrentKm,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import { saveTripObdLog } from '@/lib/obd-data';
import { loadSelectedObdBleDevice, obdBle, type ObdLiveData } from '@/lib/obd-ble';
import {
  cancelManualTrip,
  completeManualTrip,
  fetchActiveTrips,
  fetchVehiclesReadOnly,
  startManualTrip,
  type TripSummary,
  type VehicleSummary,
} from '@/lib/readonly-data';

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
  return `${value.toLocaleString('ko-KR')} km`;
}

export default function TripScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [operatorRank, setOperatorRank] = useState('');
  const [userName, setUserName] = useState('');
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
      for (const trip of activeTripsRef.current) {
        void saveCurrentGpsPoint(trip.id);
      }
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
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextVehicles, nextActiveTrips] = await Promise.all([fetchVehiclesReadOnly(50), fetchActiveTrips(20)]);
      const maintenance = await loadSyncedMaintenanceSnapshot(nextVehicles.map((vehicle) => vehicle.id));
      setVehicles(nextVehicles);
      setActiveTrips(nextActiveTrips);
      setMaintenanceSnapshot(maintenance.snapshot);
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
      const autoStartOdometer = startOdometer.trim() ? Number(startOdometer.trim()) : selectedCurrentKm ?? undefined;
      const trip = await startManualTrip({
        vehicleId: selectedVehicleId,
        startPlace,
        endPlace,
        purpose,
        operatorName,
        operatorRank,
        userName,
        startOdometer: autoStartOdometer,
      });
      setActiveTrips([trip]);
      setPurpose('');
      setEndPlace('');
      setStartOdometer('');

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
    Alert.alert('운행 취소', `${trip.vehicleNumber} 운행을 취소할까요?`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '취소',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            await cancelManualTrip(trip.id);
            setActiveTrips([]);
            stopGpsTimer();
          } catch (error) {
            Alert.alert('취소 실패', error instanceof Error ? error.message : '운행을 취소하지 못했습니다.');
          } finally {
            setIsSaving(false);
          }
        },
      },
    ]);
  }

  async function handleCompleteTrip(trip: TripSummary) {
    const finalEndPlace = endPlace.trim() || trip.endPlace || '목적지 미입력';
    const endOdo = endOdometers[trip.id]?.trim() ? Number(endOdometers[trip.id].trim()) : undefined;
    const startOdo = trip.startOdometer ?? undefined;
    setIsSaving(true);
    try {
      if (isObdConnected && obdLiveData && trip.vehicleId) {
        await saveTripObdLog(trip.vehicleId, trip.id, obdLiveData);
      }
      await completeManualTrip(trip.id, finalEndPlace, endOdo, startOdo);
      if (trip.vehicleId && endOdo !== undefined && endOdo > 0) {
        const nextSnapshot = await setVehicleCurrentKm(trip.vehicleId, endOdo);
        setMaintenanceSnapshot(nextSnapshot);
      }
      const gpsResult = await saveCurrentGpsPoint(trip.id);
      setActiveTrips([]);
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
    if (activeTrip) {
      void handleCompleteTrip(activeTrip);
      return;
    }
    void handleStartTrip();
  }

  const evMode = obdLiveData !== null && obdLiveData.speedKmh !== null && obdLiveData.speedKmh > 0 && obdLiveData.rpm === 0;
  const obdLabel = isObdConnected
    ? evMode
      ? `EV · ${obdLiveData?.speedKmh ?? '-'} km/h`
      : `RPM ${obdLiveData?.rpm ?? '-'} · ${obdLiveData?.speedKmh ?? '-'} km/h`
    : savedBleDeviceName
      ? `${savedBleDeviceName} · 운행 시작 시 자동 연결`
      : null;

  return (
    <RebuildScreen
      title="운행"
      actionLabel={isSaving ? '저장 중' : activeTrip ? '운행 종료' : '운행 시작'}
      onAction={handlePrimaryAction}>
      {isLoading ? (
        <LoadingCard label="데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : activeTrip ? (
        <SectionCard title="운행 중">
          <Text style={styles.activeTripTitle}>{activeTrip.vehicleNumber}</Text>
          <Text style={styles.activeTripRoute}>
            {activeTrip.startPlace ?? '-'} → {activeTrip.endPlace ?? '-'}
          </Text>
          <StatusLine label="시작" value={formatTime(activeTrip.startTime)} />
          {activeTrip.purpose ? <StatusLine label="목적" value={activeTrip.purpose} /> : null}
          {activeTrip.operatorName ? <StatusLine label="운전자" value={activeTrip.operatorName} /> : null}
          {activeTrip.startOdometer !== null ? <StatusLine label="출발 계기판" value={formatKm(activeTrip.startOdometer)} /> : null}
          {obdLabel ? <StatusLine label="OBD" value={obdLabel} /> : null}
          <TextInput
            style={styles.input}
            value={endOdometers[activeTrip.id] ?? ''}
            onChangeText={(value) => setEndOdometers((current) => ({ ...current, [activeTrip.id]: value }))}
            placeholder="도착 계기판 km (선택)"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
          />
          <Pressable style={styles.cancelBtnWide} onPress={() => void handleCancelTrip(activeTrip)} disabled={isSaving}>
            <Text style={styles.cancelBtnText}>운행 취소</Text>
          </Pressable>
        </SectionCard>
      ) : (
        <>
          <SectionCard title="차량">
            <VehicleDropdown
              vehicles={vehicles}
              selectedVehicleId={selectedVehicleId}
              onSelect={setSelectedVehicleId}
              placeholder="차량을 선택하세요"
            />
          </SectionCard>

          <SectionCard title="운행자">
            {savedBleDeviceName ? (
              <StatusLine label="OBD" value={isObdConnected ? '연결됨' : `${savedBleDeviceName} · 운행 시작 시 자동 연결`} />
            ) : null}
            <TextInput style={styles.input} value={operatorRank} onChangeText={setOperatorRank} placeholder="계급" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={operatorName} onChangeText={setOperatorName} placeholder="운전자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={userName} onChangeText={setUserName} placeholder="사용자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="운행 목적" placeholderTextColor="#94A3B8" />
          </SectionCard>

          <SectionCard title="경로">
            <TextInput style={styles.input} value={startPlace} onChangeText={setStartPlace} placeholder="출발지" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={endPlace} onChangeText={setEndPlace} placeholder="목적지" placeholderTextColor="#94A3B8" />
          </SectionCard>

          <SectionCard title="계기판">
            <StatusLine label="출발 자동 기준" value={formatKm(selectedCurrentKm)} />
            <TextInput
              style={styles.input}
              value={startOdometer}
              onChangeText={setStartOdometer}
              placeholder="출발 계기판 km (비우면 자동)"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
            />
          </SectionCard>
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  activeTripTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  activeTripRoute: { color: '#64748B', fontSize: 14, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  cancelBtnWide: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  cancelBtnText: { color: '#475569', fontSize: 14, fontWeight: '900' },
});
