import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import {
  completeMaintenanceItem,
  getRemainingKm,
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  MAINTENANCE_ITEMS,
  setVehicleCurrentKm,
  syncMaintenanceCompletion,
  type MaintenanceItem,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import {
  loadSelectedObdBleDevice,
  probeElm327Connection,
  saveSelectedObdBleDevice,
  scanForObdBleDevices,
  type ObdBleDevice,
  type ObdProbeResult,
} from '@/lib/obd-ble';
import { fetchVehiclesReadOnly, type VehicleSummary } from '@/lib/readonly-data';

function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `${value.toLocaleString('ko-KR')}km`;
}

function remainingLabel(remainingKm: number | null) {
  if (remainingKm === null) return '기준 주행거리 필요';
  if (remainingKm <= 0) return `${Math.abs(remainingKm).toLocaleString('ko-KR')}km 초과`;
  return `${remainingKm.toLocaleString('ko-KR')}km 남음`;
}

function isDue(remainingKm: number | null) {
  return remainingKm !== null && remainingKm <= 1000;
}

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot>({});
  const [kmInputs, setKmInputs] = useState<Record<string, string>>({});
  const [bleDevices, setBleDevices] = useState<ObdBleDevice[]>([]);
  const [selectedBleDevice, setSelectedBleDevice] = useState<ObdBleDevice | null>(null);
  const [isScanningBle, setIsScanningBle] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ObdProbeResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bleMessage, setBleMessage] = useState('검색 전');

  const dueCount = useMemo(
    () =>
      vehicles.reduce((count, vehicle) => {
        const state = getVehicleMaintenanceState(snapshot, vehicle.id);
        return count + MAINTENANCE_ITEMS.filter((item) => isDue(getRemainingKm(state, item))).length;
      }, 0),
    [snapshot, vehicles]
  );

  const loadVehicles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextVehicles = await fetchVehiclesReadOnly(50);
      const syncResult = await loadSyncedMaintenanceSnapshot(nextVehicles.map((vehicle) => vehicle.id));
      const nextSnapshot = syncResult.snapshot;
      setVehicles(nextVehicles);
      setSnapshot(nextSnapshot);
      setKmInputs(
        Object.fromEntries(
          nextVehicles.map((vehicle) => {
            const currentKm = getVehicleMaintenanceState(nextSnapshot, vehicle.id).currentKm;
            return [vehicle.id, currentKm === null ? '' : String(currentKm)];
          })
        )
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '차량 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  useEffect(() => {
    void loadSelectedObdBleDevice().then((device) => {
      setSelectedBleDevice(device);
      if (device) setBleMessage(`${device.name} 선택됨`);
    });
  }, []);

  async function saveCurrentKm(vehicle: VehicleSummary) {
    const currentKm = Number(kmInputs[vehicle.id]?.replace(/,/g, '').trim());
    if (!Number.isFinite(currentKm) || currentKm < 0) {
      Alert.alert('주행거리 확인', '현재 주행거리를 숫자로 입력해 주세요.');
      return null;
    }
    const nextSnapshot = await setVehicleCurrentKm(vehicle.id, currentKm);
    setSnapshot(nextSnapshot);
    setKmInputs((current) => ({ ...current, [vehicle.id]: String(Math.round(currentKm)) }));
    return Math.round(currentKm);
  }

  async function handleSaveCurrentKm(vehicle: VehicleSummary) {
    setIsSaving(true);
    try {
      const currentKm = await saveCurrentKm(vehicle);
      if (currentKm !== null) {
        Alert.alert('저장 완료', `${vehicle.vehicleNumber} 주행거리 ${formatKm(currentKm)} 저장됨`);
      }
    } catch (error) {
      Alert.alert('저장 실패', error instanceof Error ? error.message : '주행거리를 저장하지 못했습니다.');
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
      Alert.alert('교체완료', `${vehicle.vehicleNumber} ${item.label} 교체를 ${formatKm(currentKm)} 기준으로 기록했습니다.`);
    } catch (error) {
      Alert.alert('교체 기록 실패', error instanceof Error ? error.message : '교체 기록을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleScanObdBle() {
    setIsScanningBle(true);
    setBleMessage('검색 중…');
    try {
      const result = await scanForObdBleDevices();
      setBleDevices(result.devices);
      setBleMessage(result.message);
      if (!result.ok) Alert.alert('OBD 검색', result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBD BLE 검색에 실패했습니다.';
      setBleMessage(message);
      Alert.alert('OBD 검색 실패', message);
    } finally {
      setIsScanningBle(false);
    }
  }

  async function handleSelectBleDevice(device: ObdBleDevice) {
    await saveSelectedObdBleDevice(device);
    setSelectedBleDevice(device);
    setProbeResult(null);
    setBleMessage(`${device.name} 선택됨`);
  }

  async function handleProbeElm327() {
    if (!selectedBleDevice) return;
    setIsProbing(true);
    setProbeResult(null);
    setBleMessage('ELM327 테스트 중…');
    try {
      const result = await probeElm327Connection(selectedBleDevice.id);
      setProbeResult(result);
      setBleMessage(result.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ELM327 프로브 실패';
      setBleMessage(message);
      Alert.alert('연결 테스트 실패', message);
    } finally {
      setIsProbing(false);
    }
  }

  return (
    <RebuildScreen
      title="차량 관리"
      metrics={[
        { label: '등록 차량', value: `${vehicles.length}대` },
        { label: '교체 임박', value: `${dueCount}건` },
      ]}
      actionLabel={isSaving ? '저장 중…' : '새로고침'}
      onAction={() => void loadVehicles()}>

      <SectionCard title="OBD BLE 장치">
        <StatusLine label="상태" value={bleMessage} />
        {selectedBleDevice ? <StatusLine label="선택 장치" value={selectedBleDevice.name} /> : null}
        <Pressable style={styles.bleScanBtn} onPress={() => void handleScanObdBle()} disabled={isScanningBle || isProbing}>
          <Text style={styles.bleScanBtnText}>{isScanningBle ? '검색 중…' : 'BLE 스캐너 검색'}</Text>
        </Pressable>
        {bleDevices.map((device) => (
          <Pressable key={device.id} style={styles.bleDeviceBtn} onPress={() => void handleSelectBleDevice(device)}>
            <View style={styles.bleDeviceInfo}>
              <Text style={styles.bleDeviceName}>{device.name}</Text>
              <Text style={styles.bleDeviceMeta}>RSSI {device.rssi ?? '-'}</Text>
            </View>
            <Text style={[styles.bleDeviceAction, selectedBleDevice?.id === device.id && styles.bleDeviceActionSelected]}>
              {selectedBleDevice?.id === device.id ? '선택됨 ✓' : '선택'}
            </Text>
          </Pressable>
        ))}
        {selectedBleDevice && (
          <Pressable
            style={[styles.bleProbeBtn, isProbing && styles.bleProbeBtnDisabled]}
            onPress={() => void handleProbeElm327()}
            disabled={isProbing || isScanningBle}>
            <Text style={styles.bleProbeBtnText}>
              {isProbing ? 'ELM327 테스트 중…' : `ELM327 연결 테스트`}
            </Text>
          </Pressable>
        )}
        {probeResult && (
          <View style={styles.probeResultCard}>
            <View style={styles.probeResultHeader}>
              <Text style={styles.probeResultTitle}>테스트 결과</Text>
              <View style={[styles.probeResultBadge, probeResult.ok ? styles.probeResultBadgeOk : styles.probeResultBadgeFail]}>
                <Text style={styles.probeResultBadgeText}>{probeResult.ok ? '성공' : '실패'}</Text>
              </View>
            </View>
            {probeResult.profile ? <StatusLine label="프로필" value={probeResult.profile} /> : null}
            {probeResult.rpm !== null ? <StatusLine label="RPM" value={String(probeResult.rpm)} /> : null}
            {probeResult.speedKmh !== null ? <StatusLine label="속도" value={`${probeResult.speedKmh} km/h`} /> : null}
            {probeResult.batteryV !== null ? <StatusLine label="배터리" value={`${probeResult.batteryV}V`} /> : null}
          </View>
        )}
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="차량 목록 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : vehicles.length === 0 ? (
        <SectionCard title="차량 없음" body="등록된 차량이 없습니다." />
      ) : (
        vehicles.map((vehicle) => {
          const state = getVehicleMaintenanceState(snapshot, vehicle.id);
          return (
            <SectionCard key={vehicle.id} title={vehicle.vehicleNumber}>
              <View style={styles.kmRow}>
                <TextInput
                  style={styles.kmInput}
                  value={kmInputs[vehicle.id] ?? ''}
                  onChangeText={(value) => setKmInputs((current) => ({ ...current, [vehicle.id]: value }))}
                  placeholder="현재 주행거리 km"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                />
                <Pressable style={styles.saveBtn} onPress={() => void handleSaveCurrentKm(vehicle)} disabled={isSaving}>
                  <Text style={styles.saveBtnText}>저장</Text>
                </Pressable>
              </View>
              <StatusLine label="현재 기준" value={formatKm(state.currentKm)} />

              {MAINTENANCE_ITEMS.map((item) => {
                const remainingKm = getRemainingKm(state, item);
                const completedKm = state.completedKm[item.key];
                const due = isDue(remainingKm);
                return (
                  <View key={item.key} style={[styles.itemCard, due && styles.itemCardDue]}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemTitle}>{item.label}</Text>
                      <Text style={[styles.remaining, due && styles.remainingDue]}>{remainingLabel(remainingKm)}</Text>
                    </View>
                    <StatusLine label="최근 교체" value={formatKm(completedKm)} />
                    <StatusLine
                      label="다음 교체"
                      value={completedKm === undefined ? '-' : formatKm(completedKm + item.intervalKm)}
                    />
                    <Pressable style={styles.completeBtn} onPress={() => void handleComplete(vehicle, item)} disabled={isSaving}>
                      <Text style={styles.completeBtnText}>교체완료</Text>
                    </Pressable>
                  </View>
                );
              })}
            </SectionCard>
          );
        })
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  kmRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  kmInput: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
  saveBtn: {
    minWidth: 68,
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  itemCard: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14, marginTop: 14 },
  itemCardDue: { borderTopColor: '#DBEAFE' },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 2,
  },
  itemTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  remaining: { color: '#0F766E', fontSize: 13, fontWeight: '900', textAlign: 'right', flexShrink: 1 },
  remainingDue: { color: '#DC2626' },
  completeBtn: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  completeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  bleScanBtn: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  bleScanBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  bleDeviceBtn: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bleDeviceInfo: { flex: 1, minWidth: 0 },
  bleDeviceName: { color: '#0F172A', fontSize: 14, fontWeight: '900' },
  bleDeviceMeta: { color: '#64748B', fontSize: 12, fontWeight: '700', marginTop: 2 },
  bleDeviceAction: { color: '#2563EB', fontSize: 13, fontWeight: '900' },
  bleDeviceActionSelected: { color: '#0F766E' },
  bleProbeBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  bleProbeBtnDisabled: { backgroundColor: '#94A3B8' },
  bleProbeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  probeResultCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    padding: 14,
  },
  probeResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  probeResultTitle: { color: '#0F172A', fontSize: 14, fontWeight: '900' },
  probeResultBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  probeResultBadgeOk: { backgroundColor: '#D1FAE5' },
  probeResultBadgeFail: { backgroundColor: '#FEE2E2' },
  probeResultBadgeText: { fontSize: 12, fontWeight: '900', color: '#0F172A' },
});
