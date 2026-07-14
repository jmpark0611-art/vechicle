import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { saveCurrentGpsPoint } from '@/lib/gps-data';
import { saveTripObdLog } from '@/lib/obd-data';
import { obdBle, loadSelectedObdBleDevice, type ObdLiveData } from '@/lib/obd-ble';
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

export default function TripScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [userName, setUserName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startPlace, setStartPlace] = useState('본부대');
  const [endPlace, setEndPlace] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [endOdometers, setEndOdometers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // OBD state (background, no dedicated UI panel)
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
        _stopObdSaveTimer();
      },
    });

    return () => {
      obdBle.stopPolling();
      void obdBle.disconnect();
      _stopObdSaveTimer();
      _stopGpsTimer();
    };
  }, []);

  useEffect(() => {
    void loadSelectedObdBleDevice().then((device) => {
      if (device) {
        setSavedBleDeviceId(device.id);
        setSavedBleDeviceName(device.name);
      }
    });
  }, []);

  function _startObdSaveTimer() {
    _stopObdSaveTimer();
    obdSaveTimerRef.current = setInterval(() => {
      const trips = activeTripsRef.current;
      const live = obdLiveRef.current;
      if (!live || trips.length === 0) return;
      for (const trip of trips) {
        if (trip.vehicleId) {
          void saveTripObdLog(trip.vehicleId, trip.id, live);
        }
      }
    }, 30_000);
  }

  function _stopObdSaveTimer() {
    if (obdSaveTimerRef.current !== null) {
      clearInterval(obdSaveTimerRef.current);
      obdSaveTimerRef.current = null;
    }
  }

  function _startGpsTimer() {
    _stopGpsTimer();
    gpsTimerRef.current = setInterval(() => {
      const trips = activeTripsRef.current;
      if (trips.length === 0) return;
      for (const trip of trips) {
        void saveCurrentGpsPoint(trip.id);
      }
    }, 60_000);
  }

  function _stopGpsTimer() {
    if (gpsTimerRef.current !== null) {
      clearInterval(gpsTimerRef.current);
      gpsTimerRef.current = null;
    }
  }

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextVehicles, nextActiveTrips] = await Promise.all([fetchVehiclesReadOnly(50), fetchActiveTrips(20)]);
      setVehicles(nextVehicles);
      setActiveTrips(nextActiveTrips);
      setSelectedVehicleId((current) => current ?? nextVehicles[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '운행 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        userName,
        startOdometer: startOdometer.trim() ? Number(startOdometer.trim()) : undefined,
      });
      setActiveTrips((current) => [trip, ...current]);
      setPurpose('');
      setEndPlace('');
      setStartOdometer('');
      // Auto-connect OBD if device is saved
      if (savedBleDeviceId && !isObdConnected) {
        void obdBle.connect(savedBleDeviceId).then((result) => {
          if (result.ok) {
            setIsObdConnected(true);
            obdBle.startPolling(2000);
            _startObdSaveTimer();
          }
        });
      }
      const gpsResult = await saveCurrentGpsPoint(trip.id);
      _startGpsTimer();
      Alert.alert('운행 시작', `${trip.vehicleNumber} 운행을 시작했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 시작 실패', error instanceof Error ? error.message : '운행을 시작하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelTrip(trip: TripSummary) {
    Alert.alert('운행 취소', `${trip.vehicleNumber} 운행을 취소하시겠습니까?`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '취소',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            await cancelManualTrip(trip.id);
            setActiveTrips((current) => {
              const next = current.filter((item) => item.id !== trip.id);
              if (next.length === 0) _stopGpsTimer();
              return next;
            });
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
      const gpsResult = await saveCurrentGpsPoint(trip.id);
      setActiveTrips((current) => current.filter((item) => item.id !== trip.id));
      if (activeTrips.length <= 1) {
        obdBle.stopPolling();
        void obdBle.disconnect();
        _stopObdSaveTimer();
        _stopGpsTimer();
        setIsObdConnected(false);
        setObdLiveData(null);
      }
      Alert.alert('운행 종료', `${trip.vehicleNumber} 운행을 종료했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 종료 실패', error instanceof Error ? error.message : '운행을 종료하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  const evMode = obdLiveData !== null && obdLiveData.speedKmh !== null && obdLiveData.speedKmh > 0 && obdLiveData.rpm === 0;
  const obdLabel = isObdConnected
    ? evMode
      ? `EV · ${obdLiveData?.speedKmh ?? '-'} km/h`
      : `RPM ${obdLiveData?.rpm ?? '-'} · ${obdLiveData?.speedKmh ?? '-'} km/h`
    : savedBleDeviceName
      ? `${savedBleDeviceName} — 운행 시작 시 자동 연결`
      : null;

  return (
    <RebuildScreen
      title="운행"
      metrics={[
        { label: '차량', value: `${vehicles.length}대` },
        { label: '진행 중', value: `${activeTrips.length}건` },
      ]}
      actionLabel={isSaving ? '저장 중…' : '운행 시작'}
      onAction={() => void handleStartTrip()}>

      {isLoading ? (
        <LoadingCard label="데이터 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : (
        <>
          <SectionCard title="차량 선택">
            <View style={styles.vehicleList}>
              {vehicles.map((vehicle) => (
                <Pressable
                  key={vehicle.id}
                  style={[styles.vehiclePill, selectedVehicleId === vehicle.id && styles.vehiclePillActive]}
                  onPress={() => setSelectedVehicleId(vehicle.id)}>
                  <Text style={[styles.vehiclePillText, selectedVehicleId === vehicle.id && styles.vehiclePillTextActive]}>
                    {vehicle.vehicleNumber}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SectionCard>

          <SectionCard title="운행 정보">
            <TextInput style={styles.input} value={operatorName} onChangeText={setOperatorName} placeholder="운전자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={userName} onChangeText={setUserName} placeholder="사용자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="운행 목적" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={startPlace} onChangeText={setStartPlace} placeholder="출발지" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={endPlace} onChangeText={setEndPlace} placeholder="목적지" placeholderTextColor="#94A3B8" />
            <TextInput
              style={styles.input}
              value={startOdometer}
              onChangeText={setStartOdometer}
              placeholder="출발 계기판 km (선택)"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
            />
          </SectionCard>

          {activeTrips.length > 0 && (
            <SectionCard title={`진행 중 운행 ${activeTrips.length}건`}>
              {activeTrips.map((trip, index) => (
                <View key={trip.id} style={[styles.activeTrip, index === 0 && styles.activeTripFirst]}>
                  <Text style={styles.activeTripTitle}>{trip.vehicleNumber}</Text>
                  <Text style={styles.activeTripRoute}>
                    {trip.startPlace ?? '-'} → {trip.endPlace ?? '-'}
                  </Text>
                  <StatusLine label="시작" value={formatTime(trip.startTime)} />
                  {trip.purpose ? <StatusLine label="목적" value={trip.purpose} /> : null}
                  {trip.operatorName ? <StatusLine label="운전자" value={trip.operatorName} /> : null}
                  {trip.startOdometer !== null && (
                    <StatusLine label="출발 계기판" value={`${trip.startOdometer} km`} />
                  )}
                  {obdLabel ? <StatusLine label="OBD" value={obdLabel} /> : null}
                  <TextInput
                    style={styles.input}
                    value={endOdometers[trip.id] ?? ''}
                    onChangeText={(v) => setEndOdometers((prev) => ({ ...prev, [trip.id]: v }))}
                    placeholder="도착 계기판 km (선택)"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <View style={styles.tripBtnRow}>
                    <Pressable style={styles.completeBtn} onPress={() => void handleCompleteTrip(trip)} disabled={isSaving}>
                      <Text style={styles.completeBtnText}>운행 종료</Text>
                    </Pressable>
                    <Pressable style={styles.cancelBtn} onPress={() => void handleCancelTrip(trip)} disabled={isSaving}>
                      <Text style={styles.cancelBtnText}>취소</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </SectionCard>
          )}
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  vehicleList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  vehiclePill: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  vehiclePillActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  vehiclePillText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  vehiclePillTextActive: { color: '#2563EB' },
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
  activeTrip: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14, marginTop: 14 },
  activeTripFirst: { borderTopWidth: 0, paddingTop: 4, marginTop: 4 },
  activeTripTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  activeTripRoute: { color: '#64748B', fontSize: 13, fontWeight: '700', marginTop: 4 },
  tripBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  completeBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  cancelBtn: {
    minWidth: 72,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { color: '#64748B', fontSize: 14, fontWeight: '900' },
});
