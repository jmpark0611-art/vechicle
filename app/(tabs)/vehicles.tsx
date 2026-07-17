import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
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

function formatObdDate(reading: ObdReading | null | undefined) {
  if (!reading) return '데이터 없음';
  const date = new Date(reading.recordedAt);
  if (Number.isNaN(date.getTime())) return '최근 감지';
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function liveToReading(vehicleId: string, data: ObdLiveData): ObdReading {
  return buildObdReading(vehicleId, {
    ...EMPTY_OBD_INPUT,
    rpm: data.rpm === null ? '' : String(data.rpm),
    speedKmh: data.speedKmh === null ? '' : String(data.speedKmh),
    coolantTempC: data.coolantC === null ? '' : String(data.coolantC),
    batteryVoltage: data.batteryV === null ? '' : String(data.batteryV),
    fuelPercent: data.fuelPercent === null ? '' : String(data.fuelPercent),
  });
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

  selectedVehicleIdRef.current = selectedVehicleId;

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
        { title: 'ECU 상태', value: selectedObd ? '감지됨' : '미감지', detail: formatObdDate(selectedObd), tone: selectedObd ? 'ok' : 'wait' },
        { title: '냉각수', value: selectedObd?.coolantTempC == null ? '-' : `${selectedObd.coolantTempC}°C`, detail: 'ECU 센서', tone: selectedObd?.coolantTempC != null && selectedObd.coolantTempC >= 105 ? 'bad' : 'ok' },
        { title: '배터리', value: selectedObd?.batteryVoltage == null ? '-' : `${selectedObd.batteryVoltage}V`, detail: '전압 상태', tone: selectedObd?.batteryVoltage != null && selectedObd.batteryVoltage < 12 ? 'bad' : 'ok' },
        { title: '연료 잔량', value: selectedObd?.fuelPercent == null ? '-' : `${selectedObd.fuelPercent}%`, detail: '증가 시 주유 추정', tone: selectedObd?.fuelPercent != null && selectedObd.fuelPercent < 20 ? 'warn' : 'ok' },
        { title: '고장 코드', value: selectedObd?.dtcCount == null ? '-' : `${selectedObd.dtcCount}건`, detail: 'DTC 감지', tone: selectedObd?.dtcCount ? 'bad' : 'ok' },
        { title: 'OBD 속도', value: selectedObd?.speedKmh == null ? '-' : `${selectedObd.speedKmh}km/h`, detail: '최근 수신값', tone: 'ok' },
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
      <Pressable style={styles.registerOpenBtn} onPress={() => setIsRegisterOpen(true)}>
        <Text style={styles.registerOpenText}>차량 등록</Text>
      </Pressable>

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
            <SectionCard title="">
              <View style={styles.vehicleInfoBar}>
                <Text style={styles.vehicleInfoNumber}>{selectedVehicle.vehicleNumber}</Text>
                <View style={styles.vehicleInfoDivider} />
                <Text style={styles.vehicleInfoLabel}>현재 기준</Text>
                <Text style={styles.vehicleInfoValue}>{formatKm(selectedState.currentKm)}</Text>
              </View>
              <Text style={styles.groupTitle}>ECU 감지 정보</Text>
              <View style={styles.grid}>
                {ecuCards.map((card, index) => (
                  <View key={card.title} style={[styles.squareCard, { backgroundColor: ECU_COLORS[index % ECU_COLORS.length] }, card.tone === 'bad' && styles.squareCardBad, card.tone === 'warn' && styles.squareCardWarn]}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                    <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                    <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.groupTitle}>주기성 교환품목</Text>
              <View style={styles.grid}>
                {maintenanceCards.map((card, index) => (
                  <View key={card.item.key} style={[styles.squareCard, { backgroundColor: PART_COLORS[index % PART_COLORS.length] }, card.tone === 'bad' && styles.squareCardBad, card.tone === 'warn' && styles.squareCardWarn]}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                    <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                    <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                    <Pressable style={styles.cardAction} onPress={() => void handleComplete(selectedVehicle, card.item)} disabled={isSaving}>
                      <Text style={styles.cardActionText}>교체완료</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </SectionCard>
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
  registerOpenBtn: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: '#8EA7FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  registerOpenText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
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
  vehicleInfoBar: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#F6F8FE',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  vehicleInfoNumber: { color: '#1E2946', fontSize: 17, fontWeight: '900' },
  vehicleInfoDivider: { width: 1, height: 18, backgroundColor: '#E1E6F3' },
  vehicleInfoLabel: { color: '#7B86A8', fontSize: 12, fontWeight: '900' },
  vehicleInfoValue: { color: '#1E2946', fontSize: 13, fontWeight: '900', marginLeft: 'auto' },
  groupTitle: { color: '#52607D', fontSize: 13, fontWeight: '900', marginTop: 12, marginBottom: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  squareCard: {
    width: '48%',
    minHeight: 122,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    padding: 11,
    justifyContent: 'space-between',
  },
  squareCardBad: { borderColor: '#FFC6C6', backgroundColor: '#FFEAEA' },
  squareCardWarn: { borderColor: '#FFE2A8' },
  cardTitle: { color: '#52607D', fontSize: 12, fontWeight: '900' },
  cardValue: { color: '#222B45', fontSize: 18, fontWeight: '900', lineHeight: 22 },
  cardDetail: { color: '#7180A3', fontSize: 11, fontWeight: '800' },
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
