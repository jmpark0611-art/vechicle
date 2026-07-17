import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { showLiveEcuAlertPopup } from '@/lib/fleet-alerts';
import {
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  mergeVehicleCurrentKm,
  setVehicleCurrentKm,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import { buildObdReading, EMPTY_OBD_INPUT, loadSyncedObdSnapshot, saveObdReading, type ObdReading, type ObdSnapshot } from '@/lib/obd-data';
import {
  loadSelectedObdBleDevice,
  obdBle,
  saveSelectedObdBleDevice,
  scanForObdBleDevices,
  type ObdLiveData,
} from '@/lib/obd-ble';
import { createVehicle, fetchLatestVehicleOdometers, fetchVehiclesReadOnly, type VehicleSummary } from '@/lib/readonly-data';

const ECU_COLORS = ['#EAF2FF', '#EAFBF4', '#FFF4DE', '#F1ECFF', '#FFEFF3'];

function liveToReading(vehicleId: string, data: ObdLiveData): ObdReading {
  return {
    ...buildObdReading(vehicleId, {
    ...EMPTY_OBD_INPUT,
    rpm: data.rpm === null ? '' : String(data.rpm),
    speedKmh: data.speedKmh === null ? '' : String(data.speedKmh),
    coolantTempC: data.coolantC === null ? '' : String(data.coolantC),
    batteryVoltage: data.batteryV === null ? '' : String(data.batteryV),
    fuelPercent: data.fuelPercent === null ? '' : String(data.fuelPercent),
    dtcCount: data.dtcCount === null ? '' : String(data.dtcCount),
    }),
    intakeTempC: data.intakeTempC,
    throttlePercent: data.throttlePercent,
    engineLoadPercent: data.engineLoadPercent,
    mapKpa: data.mapKpa,
    shortFuelTrimPercent: data.shortFuelTrimPercent,
    longFuelTrimPercent: data.longFuelTrimPercent,
    oxygenSensorV: data.oxygenSensorV,
    vin: data.vin,
    readinessSummary: data.readinessSummary,
  };
}

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot>({});
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [obdStatus, setObdStatus] = useState('단말기 미연결');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [newVehicleType, setNewVehicleType] = useState('');
  const [newVehicleKm, setNewVehicleKm] = useState('');
  const lastSaveAtRef = useRef(0);
  const selectedVehicleIdRef = useRef<string | null>(null);
  const vehiclesRef = useRef<VehicleSummary[]>([]);

  selectedVehicleIdRef.current = selectedVehicleId;
  vehiclesRef.current = vehicles;

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null,
    [selectedVehicleId, vehicles]
  );

  const loadVehicles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextVehicles = await fetchVehiclesReadOnly(200);
      const vehicleIds = nextVehicles.map((vehicle) => vehicle.id);
      const [syncResult, obdResult, latestOdometers] = await Promise.all([
        loadSyncedMaintenanceSnapshot(vehicleIds),
        loadSyncedObdSnapshot(vehicleIds),
        fetchLatestVehicleOdometers(vehicleIds),
      ]);
      const nextSnapshot = await mergeVehicleCurrentKm(syncResult.snapshot, latestOdometers);
      setVehicles(nextVehicles);
      setSnapshot(nextSnapshot);
      setObdSnapshot(obdResult.snapshot);
      setSelectedVehicleId((current) => current ?? nextVehicles[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '진단 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    obdBle.setCallbacks({
      onData: (data) => {
        const vehicleId = selectedVehicleIdRef.current;
        setObdStatus(`연결됨 · ${data.speedKmh ?? '-'}km/h · 연료 ${data.fuelPercent ?? '-'}%`);
        if (!vehicleId) return;

        try {
          const vehicle = vehiclesRef.current.find((item) => item.id === vehicleId);
          if (vehicle) {
            void showLiveEcuAlertPopup(vehicle, data);
          }
          const reading = liveToReading(vehicleId, data);
          setObdSnapshot((current) => ({ ...current, [vehicleId]: reading }));
          const now = Date.now();
          if (now - lastSaveAtRef.current > 30_000) {
            lastSaveAtRef.current = now;
            void saveObdReading(reading);
          }
        } catch {
          // Empty OBD frames can arrive while the adapter is warming up.
        }
      },
      onStatus: setObdStatus,
      onDisconnect: () => setObdStatus('단말기 연결 해제'),
    });

    return () => {
      obdBle.stopPolling();
      void obdBle.disconnect();
    };
  }, []);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  async function handleConnectDevice() {
    if (!selectedVehicle) {
      Alert.alert('차량 선택 필요', '단말기 데이터를 저장할 차량을 먼저 선택해 주세요.');
      return;
    }

    setIsConnecting(true);
    try {
      let device = await loadSelectedObdBleDevice();
      if (!device) {
        const scan = await scanForObdBleDevices();
        if (!scan.ok || scan.devices.length === 0) {
          Alert.alert('단말기 검색 실패', scan.message);
          return;
        }
        device = scan.devices[0];
        await saveSelectedObdBleDevice(device);
      }

      setObdStatus(`${device.name} 연결 중`);
      const result = await obdBle.connect(device.id);
      if (!result.ok) {
        Alert.alert('단말기 연결 실패', result.message);
        setObdStatus(result.message);
        return;
      }
      obdBle.startPolling(2000);
      setObdStatus(`${device.name} 연결됨`);
      Alert.alert('단말기 연결', `${device.name}\n${result.message}`);
    } catch (error) {
      Alert.alert('단말기 연결 실패', error instanceof Error ? error.message : '연결 중 오류가 발생했습니다.');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleRegisterVehicle() {
    const vehicleNumber = newVehicleNumber.trim();
    const initialKm = newVehicleKm.trim() ? Number(newVehicleKm.replace(/,/g, '').trim()) : null;
    if (!vehicleNumber) {
      Alert.alert('차량번호 필요', '차량번호를 입력해 주세요.');
      return;
    }
    if (initialKm !== null && (!Number.isFinite(initialKm) || initialKm < 0)) {
      Alert.alert('주행거리 확인', '계기판 주행거리는 0 이상 숫자로 입력해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const vehicle = await createVehicle(vehicleNumber);
      if (initialKm !== null) {
        const nextSnapshot = await setVehicleCurrentKm(vehicle.id, initialKm);
        setSnapshot(nextSnapshot);
      }
      setNewVehicleNumber('');
      setNewVehicleType('');
      setNewVehicleKm('');
      setSelectedVehicleId(vehicle.id);
      setIsRegisterOpen(false);
      await loadVehicles();
      Alert.alert('차량 등록 완료', `${vehicle.vehicleNumber}${newVehicleType.trim() ? ` · ${newVehicleType.trim()}` : ''}`);
    } catch (error) {
      Alert.alert('차량 등록 실패', error instanceof Error ? error.message : '차량을 등록하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  const selectedState = selectedVehicle ? getVehicleMaintenanceState(snapshot, selectedVehicle.id) : null;
  const selectedObd = selectedVehicle ? obdSnapshot[selectedVehicle.id] : null;
  const ecuCards = selectedVehicle
    ? [
        { title: 'RPM', value: selectedObd?.rpm == null ? '-' : `${selectedObd.rpm}`, detail: '엔진 회전수', tone: 'ok' },
        { title: 'OBD 속도', value: selectedObd?.speedKmh == null ? '-' : `${selectedObd.speedKmh}km/h`, detail: '최근 수신값', tone: 'ok' },
        { title: '냉각수', value: selectedObd?.coolantTempC == null ? '-' : `${selectedObd.coolantTempC}°C`, detail: 'ECU 센서', tone: selectedObd?.coolantTempC != null && selectedObd.coolantTempC >= 105 ? 'bad' : 'ok' },
        { title: '배터리', value: selectedObd?.batteryVoltage == null ? '-' : `${selectedObd.batteryVoltage}V`, detail: '전압 상태', tone: selectedObd?.batteryVoltage != null && selectedObd.batteryVoltage < 12 ? 'bad' : 'ok' },
        { title: '연료 잔량', value: selectedObd?.fuelPercent == null ? '-' : `${selectedObd.fuelPercent}%`, detail: '증가 시 주유 추정', tone: selectedObd?.fuelPercent != null && selectedObd.fuelPercent < 20 ? 'warn' : 'ok' },
        { title: '고장 코드', value: selectedObd?.dtcCount == null ? '-' : `${selectedObd.dtcCount}건`, detail: 'DTC 감지', tone: selectedObd?.dtcCount ? 'bad' : 'ok' },
        { title: '흡기 온도', value: selectedObd?.intakeTempC == null ? '미수신' : `${selectedObd.intakeTempC}°C`, detail: 'PID 010F', tone: 'ok' },
        { title: '스로틀', value: selectedObd?.throttlePercent == null ? '미수신' : `${selectedObd.throttlePercent}%`, detail: '액셀 개폐율', tone: 'ok' },
        { title: '엔진 부하', value: selectedObd?.engineLoadPercent == null ? '미수신' : `${selectedObd.engineLoadPercent}%`, detail: 'Engine Load', tone: 'ok' },
        {
          title: '연료 트림',
          value:
            selectedObd?.shortFuelTrimPercent == null && selectedObd?.longFuelTrimPercent == null
              ? '미수신'
              : `${selectedObd.shortFuelTrimPercent ?? '-'} / ${selectedObd.longFuelTrimPercent ?? '-'}%`,
          detail: '단기 / 장기',
          tone: 'ok',
        },
        { title: 'MAP 압력', value: selectedObd?.mapKpa == null ? '미수신' : `${selectedObd.mapKpa}kPa`, detail: '흡기 매니폴드', tone: 'ok' },
        { title: '산소 센서', value: selectedObd?.oxygenSensorV == null ? '미수신' : `${selectedObd.oxygenSensorV}V`, detail: 'O2 센서 1', tone: 'ok' },
        { title: 'VIN', value: selectedObd?.vin ?? '미수신', detail: '차대번호', tone: selectedObd?.vin ? 'ok' : 'wait' },
        { title: '배출 준비', value: selectedObd?.readinessSummary ?? '미수신', detail: 'Readiness', tone: selectedObd?.readinessSummary === '준비 완료' ? 'ok' : 'warn' },
      ]
    : [];
  return (
    <RebuildScreen title="진단" bottomSpace="compact">
      <View style={styles.topActionRow}>
        <Pressable style={styles.registerOpenBtn} onPress={() => setIsRegisterOpen(true)}>
          <Text style={styles.registerOpenText}>차량 등록</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <LoadingCard label="진단 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : vehicles.length === 0 ? (
        <SectionCard title="차량 없음" body="등록된 차량이 없습니다." />
      ) : (
        <>
          <SectionCard title="차량 선택">
            <View style={styles.vehicleRow}>
              <View style={styles.dropdownWrap}>
                <VehicleDropdown
                  vehicles={vehicles}
                  selectedVehicleId={selectedVehicle?.id ?? null}
                  onSelect={setSelectedVehicleId}
                  displayLabel="차량 선택"
                  mutedDisplay
                  compact
                />
              </View>
              <Pressable style={styles.connectBtn} onPress={() => void handleConnectDevice()} disabled={isConnecting}>
                <Text style={styles.connectBtnText}>{isConnecting ? '연결 중' : '단말기 연결'}</Text>
              </Pressable>
            </View>
            <StatusLine label="상태" value={obdStatus} />
          </SectionCard>

          {selectedVehicle && selectedState ? (
            <View style={styles.diagnosisPanel}>
              <View style={styles.groupTitleRow}>
                <Text style={[styles.groupTitle, styles.ecuGroupTitle]}>ECU 감지 정보</Text>
                <Text style={[styles.detectText, selectedObd && styles.detectTextOn]}>{selectedObd ? 'ECU 감지' : '연결 전'}</Text>
              </View>
              <View style={styles.grid}>
                {ecuCards.slice(0, 8).map((card, index) => (
                  <View key={card.title} style={[styles.ecuCard, { backgroundColor: ECU_COLORS[index % ECU_COLORS.length] }, card.tone === 'bad' && styles.squareCardBad, card.tone === 'warn' && styles.squareCardWarn]}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                    <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                    <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                  </View>
                ))}
              </View>

            </View>
          ) : null}
        </>
      )}

      <Modal visible={isRegisterOpen} transparent animationType="fade" onRequestClose={() => setIsRegisterOpen(false)}>
        <View style={styles.modalDim}>
          <View style={styles.registerModal}>
            <Text style={styles.modalTitle}>차량 등록</Text>
            <TextInput style={styles.input} value={newVehicleNumber} onChangeText={setNewVehicleNumber} placeholder="차량번호" placeholderTextColor="#9AA8C7" />
            <TextInput style={styles.input} value={newVehicleType} onChangeText={setNewVehicleType} placeholder="종류 예: 카니발, 버스" placeholderTextColor="#9AA8C7" />
            <TextInput style={styles.input} value={newVehicleKm} onChangeText={setNewVehicleKm} placeholder="계기판 주행거리 km" placeholderTextColor="#9AA8C7" keyboardType="number-pad" />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setIsRegisterOpen(false)}>
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={() => void handleRegisterVehicle()} disabled={isSaving}>
                <Text style={styles.modalSaveText}>{isSaving ? '등록 중' : '등록'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  topActionRow: {
    alignItems: 'flex-end',
    marginTop: -48,
    marginBottom: 12,
    paddingRight: 2,
  },
  registerOpenBtn: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#8EA7FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    shadowColor: '#8FA3FF',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  registerOpenText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  vehicleRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dropdownWrap: { flex: 1 },
  connectBtn: {
    minHeight: 42,
    minWidth: 104,
    borderRadius: 14,
    backgroundColor: '#EAFBF4',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 0,
  },
  connectBtnText: { color: '#13866F', fontSize: 12, fontWeight: '900' },
  diagnosisPanel: {
    backgroundColor: '#FFFDFB',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 10,
    marginBottom: 8,
    shadowColor: '#B0B8D8',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  groupTitle: { fontSize: 18, fontWeight: '900', marginTop: 0, marginBottom: 2, letterSpacing: 0 },
  ecuGroupTitle: { color: '#3158E8' },
  partsGroupTitle: { color: '#13866F' },
  detectText: { color: '#9AA8C7', fontSize: 12, fontWeight: '900' },
  detectTextOn: { color: '#13866F' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 },
  ecuCard: {
    width: '48%',
    minHeight: 68,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    padding: 9,
    justifyContent: 'space-between',
  },
  squareCardBad: { borderColor: '#FFC6C6', backgroundColor: '#FFEAEA' },
  squareCardWarn: { borderColor: '#FFE2A8' },
  cardTitle: { color: '#52607D', fontSize: 11, fontWeight: '900' },
  cardValue: { color: '#222B45', fontSize: 14, fontWeight: '900', lineHeight: 16 },
  cardDetail: { color: '#7180A3', fontSize: 9, fontWeight: '800' },
  modalDim: { flex: 1, backgroundColor: 'rgba(80,88,120,0.36)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  registerModal: { width: '100%', borderRadius: 18, backgroundColor: '#FFFDFB', padding: 18 },
  modalTitle: { color: '#222B45', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  input: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    backgroundColor: '#FAFBFF',
    color: '#222B45',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#F0F2FA', alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { color: '#52607D', fontSize: 14, fontWeight: '900' },
  modalSave: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#8EA7FF', alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
