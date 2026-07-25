import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearStoredRole } from '@/lib/role';
import { getTankCapacity, setTankCapacity } from '@/lib/tank-capacity';

import { LoadingCard, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { useRoleGuard } from '@/hooks/use-role-guard';
import {
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  mergeVehicleCurrentKm,
  setVehicleCurrentKm,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import { buildObdReading, EMPTY_OBD_INPUT, loadSyncedObdSnapshot, saveObdReading, type ObdReading, type ObdSnapshot } from '@/lib/obd-data';
import {
  getVehicleNumberForObdDevice,
  loadSelectedObdBleDevice,
  obdBle,
  saveSelectedObdBleDevice,
  scanForObdBleDevices,
  type ObdBleDevice,
  type ObdLiveData,
} from '@/lib/obd-ble';
import {
  createVehicle,
  deleteVehicleAndTrips,
  fetchLatestVehicleOdometers,
  fetchVehiclesReadOnly,
  type VehicleSummary,
} from '@/lib/readonly-data';



function formatObdStatusMessage(message: string) {
  if (/was disconnected|disconnected|connection was closed|device .* disconnected/i.test(message)) {
    return '단말기 연결 해제';
  }
  if (/cancelled|canceled|timeout|timed out/i.test(message)) {
    return '단말기 응답 지연';
  }
  if (/failed|fail/i.test(message)) {
    return '단말기 연결 실패';
  }
  return message;
}

function buildObdFailureMessage(message: string) {
  const detail = formatObdStatusMessage(message);
  if (detail !== message) {
    return `${detail}\n\nAndroid-VLink 전원이 켜져 있고 휴대폰 블루투스 목록에 연결 가능한 상태인지 확인한 뒤 다시 시도해 주세요.`;
  }
  return message;
}

function displayObdDeviceName(deviceName: string | null | undefined, vehicleNumber?: string | null) {
  if (!deviceName || /^OBD 단말기$|이름 없는 BLE|unknown/i.test(deviceName)) {
    return vehicleNumber ? `${vehicleNumber} OBD 단말기` : 'OBD 단말기';
  }
  return deviceName;
}

async function scanAndRememberObdDevice(vehicleNumber?: string | null): Promise<ObdBleDevice | null> {
  const scan = await scanForObdBleDevices();
  if (!scan.ok || scan.devices.length === 0) {
    return null;
  }
  const device = scan.devices.find((item) => /vlink|obd|elm/i.test(item.name)) ?? scan.devices[0];
  const namedDevice = { ...device, name: displayObdDeviceName(device.name, vehicleNumber) };
  await saveSelectedObdBleDevice(namedDevice);
  return namedDevice;
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
  useRoleGuard(['commander', 'admin']);
  const insets = useSafeAreaInsets();

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
  const [tankCapacityInput, setTankCapacityInput] = useState('');
  const [tankCapacitySaved, setTankCapacitySaved] = useState(0);
  const lastSaveAtRef = useRef(0);
  const selectedVehicleIdRef = useRef<string | null>(null);
  const vehiclesRef = useRef<VehicleSummary[]>([]);

  selectedVehicleIdRef.current = selectedVehicleId;
  vehiclesRef.current = vehicles;

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null,
    [selectedVehicleId, vehicles]
  );

  useEffect(() => {
    const id = selectedVehicle?.id;
    if (!id) { setTankCapacityInput(''); setTankCapacitySaved(0); return; }
    void getTankCapacity(id).then((l) => {
      setTankCapacitySaved(l);
      setTankCapacityInput(l > 0 ? String(l) : '');
    });
  }, [selectedVehicle?.id]);

  const selectVehicleForObdDevice = useCallback(async (device: ObdBleDevice, sourceVehicles = vehicles) => {
    const vehicleNumber = getVehicleNumberForObdDevice(device);
    if (!vehicleNumber) return null;

    const existing = sourceVehicles.find((vehicle) => vehicle.vehicleNumber.toLowerCase() === vehicleNumber.toLowerCase());
    if (existing) {
      setSelectedVehicleId(existing.id);
      return existing;
    }

    try {
      const created = await createVehicle(vehicleNumber);
      setVehicles((current) => {
        const alreadyExists = current.some((vehicle) => vehicle.id === created.id || vehicle.vehicleNumber.toLowerCase() === vehicleNumber.toLowerCase());
        return alreadyExists ? current : [...current, created].sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber, 'ko-KR'));
      });
      setSelectedVehicleId(created.id);
      return created;
    } catch {
      try {
        const nextVehicles = await fetchVehiclesReadOnly(200);
        const existingAfterReload = nextVehicles.find((vehicle) => vehicle.vehicleNumber.toLowerCase() === vehicleNumber.toLowerCase());
        setVehicles(nextVehicles);
        if (existingAfterReload) {
          setSelectedVehicleId(existingAfterReload.id);
          return existingAfterReload;
        }
      } catch {
        // Keep OBD connection flow running even if vehicle auto-registration lookup fails.
      }
      return null;
    }
  }, [vehicles]);

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
      onStatus: (message) => setObdStatus(formatObdStatusMessage(message)),
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

  useFocusEffect(
    useCallback(() => {
      void loadVehicles();
    }, [loadVehicles])
  );

  async function handleConnectDevice() {
    if (!selectedVehicle) {
      Alert.alert('차량 선택 필요', '단말기 데이터를 저장할 차량을 먼저 선택해 주세요.');
      return;
    }

    setIsConnecting(true);
    try {
      let device = await loadSelectedObdBleDevice();
      const hadSavedDevice = Boolean(device);
      if (!device) {
        setObdStatus('OBD 단말기 자동 검색 중');
        device = await scanAndRememberObdDevice(selectedVehicle.vehicleNumber);
        if (!device) {
          Alert.alert('단말기 검색 실패', 'Android-VLink 전원과 휴대폰 블루투스 연결 상태를 확인한 뒤 다시 시도해 주세요.');
          setObdStatus('단말기 미검색');
          return;
        }
      }

      const matchedVehicle = await selectVehicleForObdDevice(device);
      if (matchedVehicle) selectedVehicleIdRef.current = matchedVehicle.id;
      setObdStatus(`${device.name} 연결 중`);
      let result = await obdBle.connect(device.id);
      if (!result.ok && hadSavedDevice) {
        setObdStatus('저장된 단말기 연결 실패 · 재검색 중');
        await obdBle.disconnect();
        const retryDevice = await scanAndRememberObdDevice(selectedVehicle.vehicleNumber);
        if (retryDevice) {
          device = retryDevice;
          const retryVehicle = await selectVehicleForObdDevice(device);
          if (retryVehicle) selectedVehicleIdRef.current = retryVehicle.id;
          setObdStatus(`${device.name} 재연결 중`);
          result = await obdBle.connect(device.id);
        }
      }

      if (!result.ok) {
        Alert.alert('단말기 연결 실패', buildObdFailureMessage(result.message));
        setObdStatus('단말기 연결 실패 · 다시 시도 필요');
        return;
      }
      obdBle.startPolling(2000);
      setObdStatus(`${device.name} 연결됨`);
      Alert.alert('단말기 연결', `${device.name}\n연결되었습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '연결 중 오류가 발생했습니다.';
      Alert.alert('단말기 연결 실패', buildObdFailureMessage(message));
      setObdStatus('단말기 연결 실패 · 다시 시도 필요');
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
      const message = error instanceof Error ? error.message : '차량을 등록하지 못했습니다.';
      Alert.alert(message.includes('이미 등록') ? '중복 차량번호' : '차량 등록 실패', message);
    } finally {
      setIsSaving(false);
    }
  }

  function confirmDeleteSelectedVehicle() {
    if (!selectedVehicle) {
      Alert.alert('차량 선택 필요', '삭제할 차량을 먼저 선택해 주세요.');
      return;
    }
    Alert.alert('차량 삭제 확인', `${selectedVehicle.vehicleNumber} 차량을 삭제할까요?\n삭제 전 한 번 더 확인해 주세요.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => void handleDeleteSelectedVehicle(selectedVehicle.id) },
    ]);
  }

  async function handleDeleteSelectedVehicle(vehicleId: string) {
    setIsSaving(true);
    try {
      await deleteVehicleAndTrips(vehicleId);
      setSelectedVehicleId(null);
      await loadVehicles();
      Alert.alert('차량 삭제 완료', '선택한 차량을 삭제했습니다.');
    } catch (error) {
      Alert.alert('차량 삭제 실패', error instanceof Error ? error.message : '차량을 삭제하지 못했습니다.');
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
        {
          title: '연료 잔량',
          value: selectedObd?.fuelPercent == null
            ? '-'
            : tankCapacitySaved > 0
              ? `${Math.round(((selectedObd.fuelPercent / 100) * tankCapacitySaved) * 10) / 10} L`
              : `${selectedObd.fuelPercent}%`,
          detail: tankCapacitySaved > 0 ? `탱크 ${tankCapacitySaved}L 기준` : '탱크 용량 미설정',
          tone: selectedObd?.fuelPercent != null && selectedObd.fuelPercent < 20 ? 'warn' : 'ok',
        },
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
    <View style={[styles.screenContainer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 54 }]}>
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>진단</Text>
      </View>

      <View style={styles.topActionRow}>
        <Pressable
          style={styles.changeRoleBtn}
          onPress={() => {
            Alert.alert('역할 변경', '현재 역할을 해제하고 선택 화면으로 이동합니다.', [
              { text: '취소', style: 'cancel' },
              { text: '변경', onPress: async () => { await clearStoredRole(); router.replace('/role-select'); } },
            ]);
          }}>
          <Text style={styles.changeRoleBtnText}>역할 변경</Text>
        </Pressable>
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
        <View style={{ flex: 1 }}>
          <SectionCard title="차량 선택">
            <View style={styles.vehicleRow}>
              <View style={styles.dropdownWrap}>
                <VehicleDropdown
                  vehicles={vehicles}
                  selectedVehicleId={selectedVehicleId}
                  onSelect={setSelectedVehicleId}
                  placeholder="차량 선택"
                  compact
                />
              </View>
              <Pressable style={styles.connectBtn} onPress={() => void handleConnectDevice()} disabled={isConnecting}>
                <Text style={styles.connectBtnText}>{isConnecting ? '연결 중' : '단말기 연결'}</Text>
              </Pressable>
            </View>
            <StatusLine label="상태" value={obdStatus} />
            <View style={styles.tankRow}>
              <Text style={styles.tankLabel}>탱크 용량</Text>
              <TextInput
                style={styles.tankInput}
                value={tankCapacityInput}
                onChangeText={setTankCapacityInput}
                onEndEditing={() => {
                  const l = Number(tankCapacityInput.trim());
                  const valid = Number.isFinite(l) && l > 0;
                  const next = valid ? l : 0;
                  setTankCapacitySaved(next);
                  if (selectedVehicle) void setTankCapacity(selectedVehicle.id, next);
                  if (!valid) setTankCapacityInput('');
                }}
                keyboardType="numeric"
                placeholder="미설정"
                placeholderTextColor="#94A3B8"
              />
              <Text style={styles.tankUnit}>L{tankCapacitySaved > 0 ? ' ✓' : ''}</Text>
            </View>
            <View style={styles.deleteRow}>
              <Pressable style={styles.deleteBtn} onPress={confirmDeleteSelectedVehicle} disabled={isSaving}>
                <Text style={styles.deleteBtnText}>차량 삭제</Text>
              </Pressable>
            </View>
          </SectionCard>

          {selectedVehicle && selectedState ? (
            <View style={styles.diagnosisPanel}>
              <View style={styles.groupTitleRow}>
                <Text style={[styles.groupTitle, styles.ecuGroupTitle]}>ECU 감지 정보</Text>
                <Text style={[styles.detectText, selectedObd && styles.detectTextOn]}>{selectedObd ? 'ECU 감지' : '연결 전'}</Text>
              </View>
              <View style={styles.ecuGrid}>
                {[0, 1, 2, 3].map((row) => (
                  <View key={row} style={styles.ecuRow}>
                    {ecuCards.slice(row * 2, row * 2 + 2).map((card) => (
                      <View key={card.title} style={[styles.ecuCard, card.tone === 'bad' && styles.squareCardBad, card.tone === 'warn' && styles.squareCardWarn]}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                        <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                        <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
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

    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#F0F4FB',
    paddingHorizontal: 18,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 2,
    paddingVertical: 4,
    marginBottom: 8,
  },
  screenTitle: { color: '#0F172A', fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  tankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5FB',
    gap: 8,
  },
  tankLabel: { color: '#64748B', fontSize: 12, fontWeight: '500', flex: 1 },
  tankInput: {
    width: 80,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'right',
  },
  tankUnit: { color: '#2563EB', fontSize: 13, fontWeight: '700', minWidth: 28 },
  changeRoleBtn: { paddingVertical: 6, paddingHorizontal: 2 },
  changeRoleBtnText: { color: '#64748B', fontSize: 13, fontWeight: '700' },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingRight: 2,
  },
  registerOpenBtn: {
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  registerOpenText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  vehicleRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dropdownWrap: { flex: 1 },
  connectBtn: {
    minHeight: 42,
    minWidth: 104,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F4',
    backgroundColor: '#F5F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 0,
  },
  connectBtnText: { color: '#2563EB', fontSize: 12, fontWeight: '600' },
  deleteRow: { flexDirection: 'row', marginTop: 12 },
  deleteBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#FFF1F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { color: '#E11D48', fontSize: 12, fontWeight: '600' },
  diagnosisPanel: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    padding: 10,
    marginBottom: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  groupTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  ecuGroupTitle: { color: '#2563EB' },
  detectText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  detectTextOn: { color: '#15803D' },
  ecuGrid: { flex: 1, gap: 6, marginTop: 6 },
  ecuRow: { flex: 1, flexDirection: 'row', gap: 6 },
  ecuCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  squareCardBad: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  squareCardWarn: { borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
  cardTitle: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  cardValue: { color: '#0F172A', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  cardDetail: { color: '#94A3B8', fontSize: 10, fontWeight: '500' },
  modalDim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.32)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  registerModal: { width: '100%', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18 },
  modalTitle: { color: '#0F172A', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F4',
    backgroundColor: '#F5F8FF',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '500',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { color: '#64748B', fontSize: 14, fontWeight: '500' },
  modalSave: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
