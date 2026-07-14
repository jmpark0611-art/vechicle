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
  buildObdReading,
  EMPTY_OBD_INPUT,
  inputFromReading,
  loadSyncedObdSnapshot,
  saveObdReading,
  type ObdInput,
  type ObdSnapshot,
} from '@/lib/obd-data';
import {
  loadSelectedObdBleDevice,
  probeElm327Connection,
  saveSelectedObdBleDevice,
  scanForObdBleDevices,
  type ObdBleDevice,
  type ObdProbeResult,
} from '@/lib/obd-ble';
import { fetchVehiclesReadOnly, getSupabaseReadSource, type VehicleSummary } from '@/lib/readonly-data';

function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${value.toLocaleString('ko-KR')}km`;
}

function remainingLabel(remainingKm: number | null) {
  if (remainingKm === null) {
    return '기준 주행거리 필요';
  }
  if (remainingKm <= 0) {
    return `${Math.abs(remainingKm).toLocaleString('ko-KR')}km 초과`;
  }
  return `${remainingKm.toLocaleString('ko-KR')}km 남음`;
}

function isDue(remainingKm: number | null) {
  return remainingKm !== null && remainingKm <= 1000;
}

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot>({});
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [kmInputs, setKmInputs] = useState<Record<string, string>>({});
  const [obdInputs, setObdInputs] = useState<Record<string, ObdInput>>({});
  const [bleDevices, setBleDevices] = useState<ObdBleDevice[]>([]);
  const [selectedBleDevice, setSelectedBleDevice] = useState<ObdBleDevice | null>(null);
  const [isScanningBle, setIsScanningBle] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ObdProbeResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('로컬 저장');
  const [obdSyncMessage, setObdSyncMessage] = useState('수동 기록 대기');
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
      const obdSyncResult = await loadSyncedObdSnapshot(nextVehicles.map((vehicle) => vehicle.id));
      const nextSnapshot = syncResult.snapshot;
      setVehicles(nextVehicles);
      setSnapshot(nextSnapshot);
      setObdSnapshot(obdSyncResult.snapshot);
      setSyncMessage(syncResult.message);
      setObdSyncMessage(obdSyncResult.message);
      setKmInputs(
        Object.fromEntries(
          nextVehicles.map((vehicle) => {
            const currentKm = getVehicleMaintenanceState(nextSnapshot, vehicle.id).currentKm;
            return [vehicle.id, currentKm === null ? '' : String(currentKm)];
          })
        )
      );
      setObdInputs(
        Object.fromEntries(
          nextVehicles.map((vehicle) => [vehicle.id, inputFromReading(obdSyncResult.snapshot[vehicle.id])])
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '차량 목록을 불러오지 못했습니다.';
      setErrorMessage(message);
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
      if (device) {
        setBleMessage(`${device.name} 선택됨`);
      }
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
        Alert.alert('주행거리 저장', `${vehicle.vehicleNumber} 기준 주행거리를 ${formatKm(currentKm)}로 저장했습니다.`);
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
      if (currentKm === null) {
        return;
      }
      const nextSnapshot = await completeMaintenanceItem(vehicle.id, item.key, currentKm);
      setSnapshot(nextSnapshot);
      const syncResult = await syncMaintenanceCompletion(vehicle.id, item.key, currentKm);
      setSyncMessage(syncResult.message);
      Alert.alert(
        '교체완료',
        `${vehicle.vehicleNumber} ${item.label} 교체를 ${formatKm(currentKm)} 기준으로 기록했습니다.\n${syncResult.message}`
      );
    } catch (error) {
      Alert.alert('교체 기록 실패', error instanceof Error ? error.message : '교체 기록을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveObd(vehicle: VehicleSummary) {
    setIsSaving(true);
    try {
      const reading = buildObdReading(vehicle.id, obdInputs[vehicle.id] ?? EMPTY_OBD_INPUT);
      const result = await saveObdReading(reading);
      setObdSnapshot(result.snapshot);
      setObdSyncMessage(result.message);
      setObdInputs((current) => ({ ...current, [vehicle.id]: inputFromReading(reading) }));
      Alert.alert('OBD 기록 완료', `${vehicle.vehicleNumber} 진단값을 저장했습니다.\n${result.message}`);
    } catch (error) {
      Alert.alert('OBD 기록 실패', error instanceof Error ? error.message : 'OBD 값을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  function setObdInput(vehicleId: string, key: keyof ObdInput, value: string) {
    setObdInputs((current) => ({
      ...current,
      [vehicleId]: {
        ...(current[vehicleId] ?? EMPTY_OBD_INPUT),
        [key]: value,
      },
    }));
  }

  async function handleScanObdBle() {
    setIsScanningBle(true);
    setBleMessage('BLE OBD 스캐너 검색 중');
    try {
      const result = await scanForObdBleDevices();
      setBleDevices(result.devices);
      setBleMessage(result.message);
      if (!result.ok) {
        Alert.alert('OBD 검색 안내', result.message);
      }
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
    setBleMessage('ELM327 연결 테스트 중…');
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
      title="차량 진단"
      subtitle="차량 목록과 기본 정비 주기를 확인합니다. 교체완료를 누르면 현재 주행거리부터 다음 교체시기를 다시 계산합니다."
      metrics={[
        { label: '등록 차량', value: `${vehicles.length}대` },
        { label: '교체 임박', value: `${dueCount}건` },
        { label: 'OBD 기록', value: `${Object.keys(obdSnapshot).length}대` },
        { label: 'DTC', value: `${Object.values(obdSnapshot).reduce((sum, item) => sum + (item.dtcCount ?? 0), 0)}건` },
      ]}
      actionLabel={isSaving ? '저장 중' : '차량/정비 새로고침'}
      onAction={() => void loadVehicles()}>
      <SectionCard title="Supabase" body="차량 목록은 Supabase에서 읽고, 정비 교체 기록은 Supabase 저장을 시도한 뒤 로컬에도 안전하게 보관합니다.">
        <StatusLine label="연결" value={getSupabaseReadSource()} />
        <StatusLine label="정비 동기화" value={syncMessage} />
        <StatusLine label="OBD 기록" value={obdSyncMessage} />
      </SectionCard>

      <SectionCard
        title="OBD BLE 스캐너"
        body="앱 시작 안정성을 지키기 위해 버튼을 눌렀을 때만 Bluetooth 검색을 시작합니다. BLE 방식 ELM327은 검색될 수 있고, 구형 Classic Bluetooth 모델은 휴대폰 설정에는 보여도 이 목록에는 안 보일 수 있습니다.">
        <StatusLine label="상태" value={bleMessage} />
        <StatusLine label="선택 장치" value={selectedBleDevice ? selectedBleDevice.name : '-'} />
        <Pressable style={styles.bleScanBtn} onPress={() => void handleScanObdBle()} disabled={isScanningBle || isProbing}>
          <Text style={styles.bleScanBtnText}>{isScanningBle ? '검색 중…' : 'BLE 스캐너 검색'}</Text>
        </Pressable>
        {bleDevices.map((device) => (
          <Pressable key={device.id} style={styles.bleDeviceBtn} onPress={() => void handleSelectBleDevice(device)}>
            <View style={styles.bleDeviceInfo}>
              <Text style={styles.bleDeviceName}>{device.name}</Text>
              <Text style={styles.bleDeviceMeta}>
                RSSI {device.rssi ?? '-'} · {device.id.slice(0, 18)}
              </Text>
            </View>
            <Text style={[styles.bleDeviceAction, selectedBleDevice?.id === device.id && styles.bleDeviceActionSelected]}>
              {selectedBleDevice?.id === device.id ? '선택됨' : '선택'}
            </Text>
          </Pressable>
        ))}
        {selectedBleDevice && (
          <Pressable
            style={[styles.bleProbeBtn, isProbing && styles.bleProbeBtnDisabled]}
            onPress={() => void handleProbeElm327()}
            disabled={isProbing || isScanningBle}>
            <Text style={styles.bleProbeBtnText}>
              {isProbing ? 'ELM327 테스트 중…' : `ELM327 연결 테스트 — ${selectedBleDevice.name}`}
            </Text>
          </Pressable>
        )}
        {probeResult && (
          <View style={styles.probeResultCard}>
            <View style={styles.probeResultHeader}>
              <Text style={styles.probeResultTitle}>연결 테스트 결과</Text>
              <View style={[styles.probeResultBadge, probeResult.ok ? styles.probeResultBadgeOk : styles.probeResultBadgeFail]}>
                <Text style={styles.probeResultBadgeText}>{probeResult.ok ? '성공' : '실패'}</Text>
              </View>
            </View>
            {probeResult.profile && (
              <Text style={styles.probeProfileText}>프로필: {probeResult.profile}</Text>
            )}
            {(probeResult.rpm !== null || probeResult.speedKmh !== null) && (
              <View style={styles.probeDataRow}>
                {probeResult.rpm !== null && (
                  <View style={styles.probeDataChip}>
                    <Text style={styles.probeDataLabel}>RPM</Text>
                    <Text style={styles.probeDataValue}>{probeResult.rpm}</Text>
                  </View>
                )}
                {probeResult.speedKmh !== null && (
                  <View style={styles.probeDataChip}>
                    <Text style={styles.probeDataLabel}>속도</Text>
                    <Text style={styles.probeDataValue}>{probeResult.speedKmh} km/h</Text>
                  </View>
                )}
              </View>
            )}
            {probeResult.logs.map((log: import('@/lib/obd-ble').ObdProbeLog, index: number) => (
              <View key={index} style={styles.probeLogRow}>
                <Text style={[styles.probeLogDot, log.ok ? styles.probeLogDotOk : styles.probeLogDotFail]}>●</Text>
                <View style={styles.probeLogTextWrap}>
                  <Text style={styles.probeLogStep}>{log.step}</Text>
                  {log.detail ? <Text style={styles.probeLogDetail}>{log.detail}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="차량 목록을 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="차량 목록 오류" body={errorMessage} />
      ) : vehicles.length === 0 ? (
        <SectionCard title="차량 없음" body="Supabase vehicles 테이블에 표시할 차량이 없습니다." />
      ) : (
        vehicles.map((vehicle) => {
          const state = getVehicleMaintenanceState(snapshot, vehicle.id);
          return (
            <SectionCard
              key={vehicle.id}
              title={vehicle.vehicleNumber}
              body="현재 주행거리를 입력한 뒤 부속 교체완료를 누르면 다음 교체시기가 갱신됩니다.">
              <View style={styles.kmRow}>
                <TextInput
                  style={styles.kmInput}
                  value={kmInputs[vehicle.id] ?? ''}
                  onChangeText={(value) => setKmInputs((current) => ({ ...current, [vehicle.id]: value }))}
                  placeholder="현재 주행거리"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                />
                <Pressable
                  style={styles.saveBtn}
                  onPress={() => void handleSaveCurrentKm(vehicle)}
                  disabled={isSaving}>
                  <Text style={styles.saveBtnText}>저장</Text>
                </Pressable>
              </View>

              <StatusLine label="현재 기준" value={formatKm(state.currentKm)} />
              <StatusLine label="마지막 갱신" value={state.updatedAt ? state.updatedAt.slice(0, 10) : '-'} />

              {MAINTENANCE_ITEMS.map((item) => {
                const remainingKm = getRemainingKm(state, item);
                const completedKm = state.completedKm[item.key];
                const due = isDue(remainingKm);
                return (
                  <View key={item.key} style={[styles.itemCard, due && styles.itemCardDue]}>
                    <View style={styles.itemHeader}>
                      <View>
                        <Text style={styles.itemTitle}>{item.label}</Text>
                        <Text style={styles.itemMeta}>{item.intervalKm.toLocaleString('ko-KR')}km 주기</Text>
                      </View>
                      <Text style={[styles.remaining, due && styles.remainingDue]}>{remainingLabel(remainingKm)}</Text>
                    </View>
                    <StatusLine label="최근 교체" value={formatKm(completedKm)} />
                    <StatusLine
                      label="다음 교체"
                      value={completedKm === undefined ? '-' : formatKm(completedKm + item.intervalKm)}
                    />
                    <Pressable
                      style={styles.completeBtn}
                      onPress={() => void handleComplete(vehicle, item)}
                      disabled={isSaving}>
                      <Text style={styles.completeBtnText}>교체완료</Text>
                    </Pressable>
                  </View>
                );
              })}

              <View style={styles.obdPanel}>
                <View style={styles.obdHeader}>
                  <View>
                    <Text style={styles.itemTitle}>OBD 수동 진단</Text>
                    <Text style={styles.itemMeta}>스캐너 실연결 전, 측정값을 같은 구조로 먼저 기록합니다.</Text>
                  </View>
                  <Text style={styles.obdBadge}>
                    {obdSnapshot[vehicle.id]?.recordedAt ? obdSnapshot[vehicle.id].recordedAt.slice(0, 10) : '대기'}
                  </Text>
                </View>
                <View style={styles.obdGrid}>
                  <TextInput
                    style={styles.obdInput}
                    value={obdInputs[vehicle.id]?.rpm ?? ''}
                    onChangeText={(value) => setObdInput(vehicle.id, 'rpm', value)}
                    placeholder="RPM"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={styles.obdInput}
                    value={obdInputs[vehicle.id]?.speedKmh ?? ''}
                    onChangeText={(value) => setObdInput(vehicle.id, 'speedKmh', value)}
                    placeholder="속도 km/h"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={styles.obdInput}
                    value={obdInputs[vehicle.id]?.coolantTempC ?? ''}
                    onChangeText={(value) => setObdInput(vehicle.id, 'coolantTempC', value)}
                    placeholder="냉각수 ℃"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={styles.obdInput}
                    value={obdInputs[vehicle.id]?.batteryVoltage ?? ''}
                    onChangeText={(value) => setObdInput(vehicle.id, 'batteryVoltage', value)}
                    placeholder="배터리 V"
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={styles.obdInput}
                    value={obdInputs[vehicle.id]?.fuelPercent ?? ''}
                    onChangeText={(value) => setObdInput(vehicle.id, 'fuelPercent', value)}
                    placeholder="연료 %"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={styles.obdInput}
                    value={obdInputs[vehicle.id]?.dtcCount ?? ''}
                    onChangeText={(value) => setObdInput(vehicle.id, 'dtcCount', value)}
                    placeholder="DTC 건수"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                </View>
                <StatusLine
                  label="최근 상태"
                  value={
                    obdSnapshot[vehicle.id]
                      ? `RPM ${obdSnapshot[vehicle.id].rpm ?? '-'} · 냉각수 ${obdSnapshot[vehicle.id].coolantTempC ?? '-'}℃ · 배터리 ${obdSnapshot[vehicle.id].batteryVoltage ?? '-'}V`
                      : '기록 없음'
                  }
                />
                <Pressable style={styles.obdSaveBtn} onPress={() => void handleSaveObd(vehicle)} disabled={isSaving}>
                  <Text style={styles.obdSaveBtnText}>OBD 기록 저장</Text>
                </Pressable>
              </View>
            </SectionCard>
          );
        })
      )}

      <SectionCard
        title="다음 단계"
        body="OBD 수동 기록이 안정적으로 동작하면 별도 APK에서 Bluetooth 스캐너 실연결을 붙이고, 앱 시작 안정성을 다시 확인합니다."
      />
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  kmRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  kmInput: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
  saveBtn: {
    minWidth: 72,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  itemCard: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 14,
    marginTop: 14,
  },
  itemCardDue: {
    borderTopColor: '#DBEAFE',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 2,
  },
  itemTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  itemMeta: { color: '#64748B', fontSize: 12, fontWeight: '700', marginTop: 3 },
  remaining: { color: '#0F766E', fontSize: 13, fontWeight: '900', textAlign: 'right', flexShrink: 1 },
  remainingDue: { color: '#DC2626' },
  completeBtn: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  completeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  obdPanel: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 16,
    marginTop: 16,
  },
  obdHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  obdBadge: {
    color: '#2563EB',
    backgroundColor: '#EAF2FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
  },
  obdGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  obdInput: {
    width: '48%',
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
  },
  obdSaveBtn: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  obdSaveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  bleScanBtn: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  bleScanBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  bleDeviceBtn: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bleDeviceInfo: { flex: 1, minWidth: 0 },
  bleDeviceName: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  bleDeviceMeta: { color: '#64748B', fontSize: 12, fontWeight: '700', marginTop: 3 },
  bleDeviceAction: { color: '#2563EB', fontSize: 13, fontWeight: '900' },
  bleDeviceActionSelected: { color: '#0F766E' },
  bleProbeBtn: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  bleProbeBtnDisabled: { backgroundColor: '#94A3B8' },
  bleProbeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  probeResultCard: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    padding: 16,
    gap: 8,
  },
  probeResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  probeResultTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  probeResultBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  probeResultBadgeOk: { backgroundColor: '#D1FAE5' },
  probeResultBadgeFail: { backgroundColor: '#FEE2E2' },
  probeResultBadgeText: { fontSize: 12, fontWeight: '900', color: '#0F172A' },
  probeProfileText: { color: '#2563EB', fontSize: 13, fontWeight: '800' },
  probeDataRow: { flexDirection: 'row', gap: 10, marginVertical: 4 },
  probeDataChip: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#EAF2FF',
    padding: 12,
    alignItems: 'center',
  },
  probeDataLabel: { color: '#64748B', fontSize: 11, fontWeight: '800' },
  probeDataValue: { color: '#0F172A', fontSize: 20, fontWeight: '900', marginTop: 2 },
  probeLogRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  probeLogDot: { fontSize: 10, marginTop: 3, minWidth: 14 },
  probeLogDotOk: { color: '#10B981' },
  probeLogDotFail: { color: '#EF4444' },
  probeLogTextWrap: { flex: 1, minWidth: 0 },
  probeLogStep: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  probeLogDetail: { color: '#64748B', fontSize: 11, fontWeight: '600', marginTop: 1 },
});
