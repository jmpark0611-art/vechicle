import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { showLiveEcuAlertPopup } from '@/lib/fleet-alerts';
import {
  completeMaintenanceItem,
  getRemainingKm,
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  MAINTENANCE_ITEMS,
  mergeVehicleCurrentKm,
  setVehicleCurrentKm,
  syncMaintenanceCompletion,
  type MaintenanceItem,
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

const MAINTENANCE_LABELS: Record<string, string> = {
  engineOil: '엔진오일',
  oilFilter: '오일필터',
  airFilter: '에어필터',
  fuelFilter: '연료필터',
  coolant: '냉각수',
  brakeOil: '브레이크오일',
  transmissionOil: '미션오일',
  powerSteeringOil: '파워오일',
  battery: '배터리',
  tire: '타이어',
  brakePad: '브레이크패드',
  wiperBlade: '와이퍼',
  sparkPlug: '점화플러그',
  timingBelt: '타이밍벨트',
};

const ECU_COLORS = ['#EAF2FF', '#EAFBF4', '#FFF4DE', '#F1ECFF', '#FFEFF3'];
const PART_COLORS = ['#EAFBF4', '#FFF4DE', '#EAF7FA'];

function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value).toLocaleString('ko-KR')}km`;
}

function remainingLabel(remainingKm: number | null) {
  if (remainingKm === null) return '현재 km 필요';
  if (remainingKm <= 0) return `${Math.abs(remainingKm).toLocaleString('ko-KR')}km 초과`;
  return `${remainingKm.toLocaleString('ko-KR')}km 남음`;
}

function isDue(remainingKm: number | null) {
  return remainingKm !== null && remainingKm <= 1000;
}

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
  const [kmInputs, setKmInputs] = useState<Record<string, string>>({});
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

  const dueItems = useMemo(() => {
    return vehicles.flatMap((vehicle) => {
      const state = getVehicleMaintenanceState(snapshot, vehicle.id);
      return MAINTENANCE_ITEMS
        .map((item) => ({ vehicle, item, remainingKm: getRemainingKm(state, item) }))
        .filter((entry) => isDue(entry.remainingKm));
    });
  }, [snapshot, vehicles]);

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
      setKmInputs(
        Object.fromEntries(
          nextVehicles.map((vehicle) => {
            const currentKm = getVehicleMaintenanceState(nextSnapshot, vehicle.id).currentKm;
            return [vehicle.id, currentKm === null ? '' : String(currentKm)];
          })
        )
      );
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

  async function saveCurrentKm(vehicle: VehicleSummary) {
    const currentKm = Number(kmInputs[vehicle.id]?.replace(/,/g, '').trim());
    if (!Number.isFinite(currentKm) || currentKm < 0) {
      Alert.alert('주행거리 확인', '현재 계기판 주행거리를 숫자로 입력해 주세요.');
      return null;
    }
    const nextSnapshot = await setVehicleCurrentKm(vehicle.id, currentKm);
    setSnapshot(nextSnapshot);
    setKmInputs((current) => ({ ...current, [vehicle.id]: String(Math.round(currentKm)) }));
    return Math.round(currentKm);
  }

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

  async function handleComplete(vehicle: VehicleSummary, item: MaintenanceItem) {
    setIsSaving(true);
    try {
      const currentKm = await saveCurrentKm(vehicle);
      if (currentKm === null) return;
      const nextSnapshot = await completeMaintenanceItem(vehicle.id, item.key, currentKm);
      setSnapshot(nextSnapshot);
      await syncMaintenanceCompletion(vehicle.id, item.key, currentKm);
      Alert.alert('교체 완료', `${vehicle.vehicleNumber} ${MAINTENANCE_LABELS[item.key] ?? item.label} 기준 ${formatKm(currentKm)}`);
    } catch (error) {
      Alert.alert('교체 기록 실패', error instanceof Error ? error.message : '교체 기록을 저장하지 못했습니다.');
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
  const maintenanceCards = selectedVehicle && selectedState
    ? MAINTENANCE_ITEMS.map((item) => {
        const remainingKm = getRemainingKm(selectedState, item);
        return {
          item,
          title: MAINTENANCE_LABELS[item.key] ?? item.label,
          value: remainingLabel(remainingKm),
          detail: `${item.intervalKm.toLocaleString('ko-KR')}km 주기`,
          tone: remainingKm !== null && remainingKm <= 0 ? 'bad' : remainingKm !== null && remainingKm <= 1000 ? 'warn' : 'ok',
        };
      })
    : [];

  return (
    <RebuildScreen title="진단" actionLabel="새로고침" onAction={() => void loadVehicles()}>
      <View style={styles.topActionRow}>
        <Pressable style={styles.registerOpenBtn} onPress={() => setIsRegisterOpen(true)}>
          <Text style={styles.registerOpenText}>차량 등록</Text>
        </Pressable>
      </View>

      {dueItems.length > 0 ? (
        <SectionCard title={`교체 알림 ${dueItems.length}건`}>
          {dueItems.slice(0, 8).map(({ vehicle, item, remainingKm }) => (
            <StatusLine
              key={`${vehicle.id}-${item.key}`}
              label={`${vehicle.vehicleNumber} · ${MAINTENANCE_LABELS[item.key] ?? item.label}`}
              value={remainingLabel(remainingKm)}
            />
          ))}
        </SectionCard>
      ) : null}

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
                <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicle?.id ?? null} onSelect={setSelectedVehicleId} />
              </View>
              <Pressable style={styles.connectBtn} onPress={() => void handleConnectDevice()} disabled={isConnecting}>
                <Text style={styles.connectBtnText}>{isConnecting ? '연결 중' : '단말기 연결'}</Text>
              </Pressable>
            </View>
            <StatusLine label="상태" value={obdStatus} />
          </SectionCard>

          {selectedVehicle && selectedState ? (
            <View style={styles.diagnosisPanel}>
              <View style={styles.ecuStatusBar}>
                <View>
                  <Text style={styles.ecuStatusLabel}>ECU 감지 상태</Text>
                  <Text style={styles.ecuStatusValue}>{selectedObd ? '감지됨' : '미감지'}</Text>
                </View>
                <View style={styles.ecuStatusMeta}>
                  <Text style={styles.ecuStatusMetaText}>차량 {selectedVehicle.vehicleNumber}</Text>
                  <Text style={styles.ecuStatusMetaText}>기준 {formatKm(selectedState.currentKm)}</Text>
                </View>
              </View>
              <Text style={[styles.groupTitle, styles.ecuGroupTitle]}>ECU 감지 정보</Text>
              <View style={styles.grid}>
                {ecuCards.map((card, index) => (
                  <View key={card.title} style={[styles.ecuCard, { backgroundColor: ECU_COLORS[index % ECU_COLORS.length] }, card.tone === 'bad' && styles.squareCardBad, card.tone === 'warn' && styles.squareCardWarn]}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                    <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                    <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.groupTitle, styles.partsGroupTitle]}>주기성 교환품목</Text>
              <View style={styles.grid}>
                {maintenanceCards.map((card, index) => (
                  <View key={card.item.key} style={[styles.maintenanceCard, { backgroundColor: PART_COLORS[index % PART_COLORS.length] }, card.tone === 'bad' && styles.squareCardBad, card.tone === 'warn' && styles.squareCardWarn]}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                    <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                    <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                    <Pressable style={styles.cardAction} onPress={() => void handleComplete(selectedVehicle, card.item)} disabled={isSaving}>
                      <Text style={styles.cardActionText}>교체완료</Text>
                    </Pressable>
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
    marginBottom: 18,
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
    minHeight: 50,
    minWidth: 104,
    borderRadius: 14,
    backgroundColor: '#EAFBF4',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 8,
  },
  connectBtnText: { color: '#13866F', fontSize: 12, fontWeight: '900' },
  diagnosisPanel: {
    backgroundColor: '#FFFDFB',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 12,
    marginBottom: 10,
    shadowColor: '#B0B8D8',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  ecuStatusBar: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#DDE7FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    gap: 12,
  },
  ecuStatusLabel: { color: '#52607D', fontSize: 12, fontWeight: '900' },
  ecuStatusValue: { color: '#1E2946', fontSize: 22, fontWeight: '900', marginTop: 3 },
  ecuStatusMeta: { alignItems: 'flex-end', gap: 4 },
  ecuStatusMetaText: { color: '#4F6AE6', fontSize: 12, fontWeight: '900' },
  groupTitle: { fontSize: 17, fontWeight: '900', marginTop: 18, marginBottom: 3, letterSpacing: 0 },
  ecuGroupTitle: { color: '#3158E8' },
  partsGroupTitle: { color: '#13866F' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 7 },
  ecuCard: {
    width: '48%',
    minHeight: 96,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    padding: 10,
    justifyContent: 'space-between',
  },
  maintenanceCard: {
    width: '48%',
    minHeight: 116,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    padding: 10,
    justifyContent: 'space-between',
  },
  squareCardBad: { borderColor: '#FFC6C6', backgroundColor: '#FFEAEA' },
  squareCardWarn: { borderColor: '#FFE2A8' },
  cardTitle: { color: '#52607D', fontSize: 12, fontWeight: '900' },
  cardValue: { color: '#222B45', fontSize: 17, fontWeight: '900', lineHeight: 20 },
  cardDetail: { color: '#7180A3', fontSize: 10, fontWeight: '800' },
  cardAction: {
    minHeight: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionText: { color: '#5B7CFA', fontSize: 12, fontWeight: '900' },
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
