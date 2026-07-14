import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { saveCurrentGpsPoint } from '@/lib/gps-data';
import { saveTripObdLog } from '@/lib/obd-data';
import { obdBle, loadSelectedObdBleDevice, type ObdLiveData } from '@/lib/obd-ble';
import {
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

function ObdDataChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.obdChip}>
      <Text style={styles.obdChipLabel}>{label}</Text>
      <Text style={styles.obdChipValue}>{value}</Text>
    </View>
  );
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

  // OBD state
  const [obdLiveData, setObdLiveData] = useState<ObdLiveData | null>(null);
  const [isObdConnected, setIsObdConnected] = useState(false);
  const [isObdConnecting, setIsObdConnecting] = useState(false);
  const [obdStatus, setObdStatus] = useState('장치 미연결');
  const [savedBleDeviceId, setSavedBleDeviceId] = useState<string | null>(null);
  const [savedBleDeviceName, setSavedBleDeviceName] = useState<string | null>(null);

  // Refs for the 30s obd_logs save timer (avoids stale closures)
  const activeTripsRef = useRef<TripSummary[]>([]);
  const obdLiveRef = useRef<ObdLiveData | null>(null);
  const obdSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  activeTripsRef.current = activeTrips;
  obdLiveRef.current = obdLiveData;

  // Register OBD callbacks once on mount
  useEffect(() => {
    obdBle.setCallbacks({
      onData: (data: ObdLiveData) => {
        setObdLiveData(data);
        setIsObdConnected(true);
      },
      onStatus: (msg: string) => setObdStatus(msg),
      onDisconnect: () => {
        setObdLiveData(null);
        setIsObdConnected(false);
        setObdStatus('연결 끊김');
        _stopObdSaveTimer();
      },
    });

    return () => {
      obdBle.stopPolling();
      void obdBle.disconnect();
      _stopObdSaveTimer();
    };
  }, []);

  // Load saved BLE device info on mount
  useEffect(() => {
    void loadSelectedObdBleDevice().then((device) => {
      if (device) {
        setSavedBleDeviceId(device.id);
        setSavedBleDeviceName(device.name);
        setObdStatus(`${device.name} 저장됨 — 연결 버튼을 눌러 연결`);
      } else {
        setObdStatus('차량 탭에서 OBD 장치를 먼저 선택하세요');
      }
    });
  }, []);

  function _startObdSaveTimer() {
    _stopObdSaveTimer();
    obdSaveTimerRef.current = setInterval(() => {
      const trips = activeTripsRef.current;
      const live = obdLiveRef.current;
      if (!live || trips.length === 0) return;
      // Save OBD snapshot for each active trip
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
      const gpsResult = await saveCurrentGpsPoint(trip.id);
      Alert.alert('운행 시작', `${trip.vehicleNumber} 운행을 시작했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 시작 실패', error instanceof Error ? error.message : '운행을 시작하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteTrip(trip: TripSummary) {
    const finalEndPlace = endPlace.trim() || trip.endPlace || '목적지 미입력';
    const endOdo = endOdometers[trip.id]?.trim() ? Number(endOdometers[trip.id].trim()) : undefined;
    const startOdo = trip.startOdometer ?? undefined;
    setIsSaving(true);
    try {
      // Save one last OBD snapshot before ending
      if (isObdConnected && obdLiveData && trip.vehicleId) {
        await saveTripObdLog(trip.vehicleId, trip.id, obdLiveData);
      }
      await completeManualTrip(trip.id, finalEndPlace, endOdo, startOdo);
      const gpsResult = await saveCurrentGpsPoint(trip.id);
      setActiveTrips((current) => current.filter((item) => item.id !== trip.id));
      // If no more active trips, disconnect OBD
      if (activeTrips.length <= 1) {
        obdBle.stopPolling();
        void obdBle.disconnect();
        _stopObdSaveTimer();
        setIsObdConnected(false);
        setObdLiveData(null);
        setObdStatus(savedBleDeviceName ? `${savedBleDeviceName} — 재연결 가능` : '연결 해제됨');
      }
      Alert.alert('운행 종료', `${trip.vehicleNumber} 운행을 종료했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 종료 실패', error instanceof Error ? error.message : '운행을 종료하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleObdConnect() {
    if (!savedBleDeviceId) {
      Alert.alert('OBD 장치 없음', '차량 탭 → OBD BLE 스캐너에서 장치를 먼저 선택해 주세요.');
      return;
    }
    setIsObdConnecting(true);
    setObdStatus('연결 중…');
    try {
      const result = await obdBle.connect(savedBleDeviceId);
      if (result.ok) {
        setIsObdConnected(true);
        setObdStatus(`${result.profile ?? '연결됨'}`);
        obdBle.startPolling(2000);
        _startObdSaveTimer();
      } else {
        setObdStatus(`연결 실패: ${result.message}`);
        Alert.alert('OBD 연결 실패', result.message);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'OBD 연결 오류';
      setObdStatus(`오류: ${msg}`);
      Alert.alert('OBD 연결 오류', msg);
    } finally {
      setIsObdConnecting(false);
    }
  }

  async function handleObdDisconnect() {
    obdBle.stopPolling();
    await obdBle.disconnect();
    _stopObdSaveTimer();
    setIsObdConnected(false);
    setObdLiveData(null);
    setObdStatus(savedBleDeviceName ? `${savedBleDeviceName} — 수동 해제` : '연결 해제');
  }

  const evMode = obdLiveData !== null && obdLiveData.speedKmh !== null && obdLiveData.speedKmh > 0 && obdLiveData.rpm === 0;

  return (
    <RebuildScreen
      title="운행"
      subtitle="운행을 시작하고 OBD 어댑터로 실시간 데이터를 확인합니다."
      metrics={[
        { label: '차량', value: `${vehicles.length}대` },
        { label: '진행 중', value: `${activeTrips.length}건` },
        { label: 'OBD', value: isObdConnected ? (evMode ? 'EV 모드' : '연결됨') : '미연결' },
        { label: 'RPM', value: obdLiveData?.rpm !== null && obdLiveData?.rpm !== undefined ? String(obdLiveData.rpm) : '-' },
      ]}
      actionLabel={isSaving ? '저장 중' : '운행 시작'}
      onAction={() => void handleStartTrip()}>

      {/* OBD 연결 패널 */}
      <SectionCard
        title="OBD 연결"
        body={obdStatus}>
        {!isObdConnected ? (
          <Pressable
            style={[styles.obdConnectBtn, (isObdConnecting || !savedBleDeviceId) && styles.obdConnectBtnDisabled]}
            onPress={() => void handleObdConnect()}
            disabled={isObdConnecting || !savedBleDeviceId}>
            <Text style={styles.obdConnectBtnText}>
              {isObdConnecting ? '연결 중…' : savedBleDeviceName ? `${savedBleDeviceName} 연결` : 'OBD 장치 없음'}
            </Text>
          </Pressable>
        ) : (
          <>
            {/* Live data chips */}
            <View style={styles.obdChipRow}>
              {evMode && <ObdDataChip label="모드" value="EV 주행" />}
              {!evMode && obdLiveData?.rpm !== null && obdLiveData?.rpm !== undefined && (
                <ObdDataChip label="RPM" value={String(obdLiveData.rpm)} />
              )}
              {obdLiveData?.speedKmh !== null && obdLiveData?.speedKmh !== undefined && (
                <ObdDataChip label="속도" value={`${obdLiveData.speedKmh} km/h`} />
              )}
              {obdLiveData?.coolantC !== null && obdLiveData?.coolantC !== undefined && (
                <ObdDataChip label="냉각수" value={`${obdLiveData.coolantC}°C`} />
              )}
              {obdLiveData?.batteryV !== null && obdLiveData?.batteryV !== undefined && (
                <ObdDataChip label="배터리" value={`${obdLiveData.batteryV}V`} />
              )}
              {obdLiveData?.fuelPercent !== null && obdLiveData?.fuelPercent !== undefined && (
                <ObdDataChip label="연료" value={`${obdLiveData.fuelPercent}%`} />
              )}
            </View>
            <Pressable style={styles.obdDisconnectBtn} onPress={() => void handleObdDisconnect()}>
              <Text style={styles.obdDisconnectBtnText}>OBD 연결 해제</Text>
            </Pressable>
          </>
        )}
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="운행 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="데이터 오류" body={errorMessage} />
      ) : (
        <>
          <SectionCard title="차량 선택" body={vehicles.find((v) => v.id === selectedVehicleId)?.vehicleNumber ?? '등록 차량이 없습니다.'}>
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

          <SectionCard title="운행 정보" body="운전자, 사용자, 목적, 출발지, 목적지를 입력합니다.">
            <TextInput style={styles.input} value={operatorName} onChangeText={setOperatorName} placeholder="운전자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={userName} onChangeText={setUserName} placeholder="사용자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="운행 목적" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={startPlace} onChangeText={setStartPlace} placeholder="출발지" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={endPlace} onChangeText={setEndPlace} placeholder="목적지" placeholderTextColor="#94A3B8" />
            <TextInput
              style={styles.input}
              value={startOdometer}
              onChangeText={setStartOdometer}
              placeholder="출발 시 계기판 km (선택)"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
            />
          </SectionCard>

          <SectionCard title="진행 중 운행" body="운행 종료 시 마지막 OBD 데이터가 자동 저장됩니다.">
            {activeTrips.length === 0 ? (
              <StatusLine label="상태" value="진행 중 운행 없음" />
            ) : (
              activeTrips.map((trip) => (
                <View key={trip.id} style={styles.activeTrip}>
                  <Text style={styles.activeTripTitle}>{trip.vehicleNumber}</Text>
                  <Text style={styles.activeTripRoute}>
                    {trip.startPlace ?? '출발지 없음'} → {trip.endPlace ?? '목적지 없음'}
                  </Text>
                  <StatusLine label="시작" value={formatTime(trip.startTime)} />
                  {trip.purpose ? <StatusLine label="목적" value={trip.purpose} /> : null}
                  {trip.operatorName ? <StatusLine label="운전자" value={trip.operatorName} /> : null}
                  {trip.startOdometer !== null && (
                    <StatusLine label="출발 계기판" value={`${trip.startOdometer} km`} />
                  )}
                  {isObdConnected && (
                    <StatusLine
                      label="OBD"
                      value={evMode
                        ? `EV 모드 · ${obdLiveData?.speedKmh ?? '-'} km/h`
                        : `RPM ${obdLiveData?.rpm ?? '-'} · ${obdLiveData?.speedKmh ?? '-'} km/h`}
                    />
                  )}
                  <TextInput
                    style={[styles.input, styles.inputSmall]}
                    value={endOdometers[trip.id] ?? ''}
                    onChangeText={(v) => setEndOdometers((prev) => ({ ...prev, [trip.id]: v }))}
                    placeholder="도착 시 계기판 km (선택)"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <Pressable style={styles.completeBtn} onPress={() => void handleCompleteTrip(trip)} disabled={isSaving}>
                    <Text style={styles.completeBtnText}>운행 종료</Text>
                  </Pressable>
                </View>
              ))
            )}
          </SectionCard>
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  obdConnectBtn: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  obdConnectBtnDisabled: { backgroundColor: '#94A3B8' },
  obdConnectBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  obdChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 4 },
  obdChip: {
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 70,
  },
  obdChipLabel: { color: '#64748B', fontSize: 10, fontWeight: '800' },
  obdChipValue: { color: '#0F172A', fontSize: 18, fontWeight: '900', marginTop: 2 },
  obdDisconnectBtn: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  obdDisconnectBtnText: { color: '#64748B', fontSize: 13, fontWeight: '900' },
  vehicleList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  vehiclePill: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  vehiclePillActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  vehiclePillText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  vehiclePillTextActive: { color: '#2563EB' },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    marginTop: 12,
  },
  inputSmall: { minHeight: 44, marginTop: 10, fontSize: 14 },
  activeTrip: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14, marginTop: 14 },
  activeTripTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  activeTripRoute: { color: '#64748B', fontSize: 13, fontWeight: '700', marginTop: 5 },
  completeBtn: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  completeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
