import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { createVehicle, fetchLatestVehicleOdometers, fetchVehiclesReadOnly, type VehicleSummary } from '@/lib/readonly-data';

function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `${value.toLocaleString('ko-KR')}km`;
}

function remainingLabel(remainingKm: number | null) {
  if (remainingKm === null) return '현재 km 필요';
  if (remainingKm <= 0) return `${Math.abs(remainingKm).toLocaleString('ko-KR')}km 초과`;
  return `${remainingKm.toLocaleString('ko-KR')}km 남음`;
}

function isDue(remainingKm: number | null) {
  return remainingKm !== null && remainingKm <= 1000;
}

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot>({});
  const [kmInputs, setKmInputs] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [newVehicleType, setNewVehicleType] = useState('');
  const [newVehicleKm, setNewVehicleKm] = useState('');

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
      const syncResult = await loadSyncedMaintenanceSnapshot(vehicleIds);
      const latestOdometers = await fetchLatestVehicleOdometers(vehicleIds);
      const nextSnapshot = await mergeVehicleCurrentKm(syncResult.snapshot, latestOdometers);
      setVehicles(nextVehicles);
      setSnapshot(nextSnapshot);
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
      setErrorMessage(error instanceof Error ? error.message : '차량 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
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

  async function handleSaveCurrentKm(vehicle: VehicleSummary) {
    setIsSaving(true);
    try {
      const currentKm = await saveCurrentKm(vehicle);
      if (currentKm !== null) Alert.alert('저장 완료', `${vehicle.vehicleNumber} 현재 ${formatKm(currentKm)}`);
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
      Alert.alert('교체 완료', `${vehicle.vehicleNumber} ${item.label} 기준 ${formatKm(currentKm)}`);
    } catch (error) {
      Alert.alert('교체 기록 실패', error instanceof Error ? error.message : '교체 기록을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  const selectedState = selectedVehicle ? getVehicleMaintenanceState(snapshot, selectedVehicle.id) : null;

  return (
    <RebuildScreen title="차량" actionLabel="새로고침" onAction={() => void loadVehicles()}>
      <Pressable style={styles.registerOpenBtn} onPress={() => setIsRegisterOpen(true)}>
        <Text style={styles.registerOpenText}>차량 등록</Text>
      </Pressable>

      {dueItems.length > 0 ? (
        <SectionCard title={`교체 알림 ${dueItems.length}건`}>
          {dueItems.slice(0, 10).map(({ vehicle, item, remainingKm }) => (
            <StatusLine key={`${vehicle.id}-${item.key}`} label={`${vehicle.vehicleNumber} · ${item.label}`} value={remainingLabel(remainingKm)} />
          ))}
        </SectionCard>
      ) : (
        <SectionCard title="교체 알림" body="현재 교체시기가 다가오는 차량이 없습니다." />
      )}

      {isLoading ? (
        <LoadingCard label="차량 목록을 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : vehicles.length === 0 ? (
        <SectionCard title="차량 없음" body="등록된 차량이 없습니다." />
      ) : (
        <>
          <SectionCard title="차량 선택">
            <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicle?.id ?? null} onSelect={setSelectedVehicleId} />
          </SectionCard>

          {selectedVehicle && selectedState ? (
            <SectionCard title={selectedVehicle.vehicleNumber}>
              <View style={styles.kmRow}>
                <TextInput
                  style={styles.kmInput}
                  value={kmInputs[selectedVehicle.id] ?? ''}
                  onChangeText={(value) => setKmInputs((current) => ({ ...current, [selectedVehicle.id]: value }))}
                  placeholder="현재 계기판 km"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                />
                <Pressable style={styles.saveBtn} onPress={() => void handleSaveCurrentKm(selectedVehicle)} disabled={isSaving}>
                  <Text style={styles.saveBtnText}>저장</Text>
                </Pressable>
              </View>
              <StatusLine label="현재 기준" value={formatKm(selectedState.currentKm)} />

              {MAINTENANCE_ITEMS.map((item) => {
                const remainingKm = getRemainingKm(selectedState, item);
                const completedKm = selectedState.completedKm[item.key];
                const due = isDue(remainingKm);
                return (
                  <View key={item.key} style={[styles.itemCard, due && styles.itemCardDue]}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemTitle}>{item.label}</Text>
                      <Text style={[styles.remaining, due && styles.remainingDue]}>{remainingLabel(remainingKm)}</Text>
                    </View>
                    <StatusLine label="최근 교체" value={formatKm(completedKm)} />
                    <StatusLine label="다음 교체" value={completedKm === undefined ? '-' : formatKm(completedKm + item.intervalKm)} />
                    <Pressable style={styles.completeBtn} onPress={() => void handleComplete(selectedVehicle, item)} disabled={isSaving}>
                      <Text style={styles.completeBtnText}>교체완료</Text>
                    </Pressable>
                  </View>
                );
              })}
            </SectionCard>
          ) : null}
        </>
      )}

      <Modal visible={isRegisterOpen} transparent animationType="fade" onRequestClose={() => setIsRegisterOpen(false)}>
        <View style={styles.modalDim}>
          <View style={styles.registerModal}>
            <Text style={styles.modalTitle}>차량 등록</Text>
            <TextInput
              style={styles.input}
              value={newVehicleNumber}
              onChangeText={setNewVehicleNumber}
              placeholder="차량번호"
              placeholderTextColor="#94A3B8"
            />
            <TextInput
              style={styles.input}
              value={newVehicleType}
              onChangeText={setNewVehicleType}
              placeholder="종류 예: 카니발, 버스"
              placeholderTextColor="#94A3B8"
            />
            <TextInput
              style={styles.input}
              value={newVehicleKm}
              onChangeText={setNewVehicleKm}
              placeholder="계기판 주행거리 km"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
            />
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
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  registerOpenText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
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
  saveBtn: { minWidth: 68, minHeight: 50, borderRadius: 12, backgroundColor: '#EAF2FF', alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  itemCard: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14, marginTop: 14 },
  itemCardDue: { borderTopColor: '#DBEAFE' },
  itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 2 },
  itemTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  remaining: { color: '#0F766E', fontSize: 13, fontWeight: '900', textAlign: 'right', flexShrink: 1 },
  remainingDue: { color: '#DC2626' },
  completeBtn: { minHeight: 44, borderRadius: 12, backgroundColor: '#0F766E', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  completeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  modalDim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.42)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  registerModal: { width: '100%', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18 },
  modalTitle: { color: '#0F172A', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { color: '#334155', fontSize: 14, fontWeight: '900' },
  modalSave: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
