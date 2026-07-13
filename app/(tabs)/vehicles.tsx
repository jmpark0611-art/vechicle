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
  const [kmInputs, setKmInputs] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('로컬 저장');

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
      setSyncMessage(syncResult.message);
      setKmInputs(
        Object.fromEntries(
          nextVehicles.map((vehicle) => {
            const currentKm = getVehicleMaintenanceState(nextSnapshot, vehicle.id).currentKm;
            return [vehicle.id, currentKm === null ? '' : String(currentKm)];
          })
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

  return (
    <RebuildScreen
      title="차량 진단"
      subtitle="차량 목록과 기본 정비 주기를 확인합니다. 교체완료를 누르면 현재 주행거리부터 다음 교체시기를 다시 계산합니다."
      metrics={[
        { label: '등록 차량', value: `${vehicles.length}대` },
        { label: '교체 임박', value: `${dueCount}건` },
        { label: 'OBD', value: '보류' },
        { label: 'DTC', value: '보류' },
      ]}
      actionLabel={isSaving ? '저장 중' : '차량/정비 새로고침'}
      onAction={() => void loadVehicles()}>
      <SectionCard title="Supabase" body="차량 목록은 Supabase에서 읽고, 정비 교체 기록은 Supabase 저장을 시도한 뒤 로컬에도 안전하게 보관합니다.">
        <StatusLine label="연결" value={getSupabaseReadSource()} />
        <StatusLine label="정비 동기화" value={syncMessage} />
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
            </SectionCard>
          );
        })
      )}

      <SectionCard
        title="다음 단계"
        body="로컬 정비 기록이 안정적으로 동작하면 Supabase 정비 테이블 동기화와 OBD 주행거리 자동 반영을 단계적으로 붙입니다."
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
});
