import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';
import { supabase } from '../../lib/supabase';

type MaintenanceItem = {
  id: string;
  name: string;
  standard_km: number;
  standard_month: number;
  warning_km: number;
  warning_month: number;
};

type VehicleMaintenance = {
  id: string;
  item_id: string;
  last_replaced_at: string | null;
  last_replaced_mileage_km: number | null;
  next_due_date: string | null;
  next_due_mileage_km: number | null;
};

type HistoryEntry = {
  id: string;
  replaced_at: string;
  mileage_km: number | null;
};

type ItemStatus = 'ok' | 'warning' | 'overdue' | 'unknown';

function getRemainingDays(nextDueDateStr: string | null): number | null {
  if (!nextDueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((new Date(nextDueDateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getRemainingKm(
  nextDueMileageKm: number | null,
  currentMileageKm: number | null
): number | null {
  if (nextDueMileageKm == null || currentMileageKm == null) return null;
  return nextDueMileageKm - currentMileageKm;
}

function computeStatus(
  record: VehicleMaintenance | null,
  item: MaintenanceItem,
  currentMileageKm: number | null
): ItemStatus {
  if (!record || !record.last_replaced_at) return 'unknown';

  // 날짜 기준
  let dateStatus: ItemStatus = 'ok';
  if (item.standard_month > 0 && record.next_due_date) {
    const d = getRemainingDays(record.next_due_date) ?? 0;
    if (d < 0) dateStatus = 'overdue';
    else if (item.warning_month > 0 && d <= item.warning_month * 30) dateStatus = 'warning';
  }

  // km 기준 (현재 주행거리 있을 때만)
  let kmStatus: ItemStatus = 'ok';
  if (currentMileageKm != null && item.standard_km > 0 && record.next_due_mileage_km != null) {
    const kmLeft = record.next_due_mileage_km - currentMileageKm;
    if (kmLeft <= 0) kmStatus = 'overdue';
    else if (item.warning_km > 0 && kmLeft <= item.warning_km) kmStatus = 'warning';
  }

  if (dateStatus === 'overdue' || kmStatus === 'overdue') return 'overdue';
  if (dateStatus === 'warning' || kmStatus === 'warning') return 'warning';
  return 'ok';
}

function formatDateKr(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function VehicleMaintenanceScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();

  const [vehicleNumber, setVehicleNumber] = useState('');
  const [currentMileageKm, setCurrentMileageKm] = useState<number | null>(null);
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [records, setRecords] = useState<Map<string, VehicleMaintenance>>(new Map());
  const [history, setHistory] = useState<Map<string, HistoryEntry[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 교체 완료 폼
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [mileageInput, setMileageInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 오도미터 업데이트 폼
  const [showMileageForm, setShowMileageForm] = useState(false);
  const [mileageUpdateInput, setMileageUpdateInput] = useState('');
  const [isUpdatingMileage, setIsUpdatingMileage] = useState(false);

  const loadData = useCallback(
    async (refreshing = false) => {
      if (!id) return;
      if (refreshing) setIsRefreshing(true);
      else setIsLoading(true);
      setErrorMessage(null);

      try {
        const [vehicleResult, itemsResult, recordsResult, historyResult] = await Promise.all([
          withTimeout(
            supabase.from('vehicles').select('vehicle_number, current_mileage_km').eq('id', id).single(),
            '차량 정보'
          ),
          withTimeout(
            supabase.from('maintenance_items').select('*').eq('active', true).order('name'),
            '정비 항목'
          ),
          withTimeout(
            supabase.from('vehicle_maintenance').select('id, item_id, last_replaced_at, last_replaced_mileage_km, next_due_date, next_due_mileage_km').eq('vehicle_id', id),
            '정비 기록'
          ),
          withTimeout(
            supabase
              .from('vehicle_maintenance_history')
              .select('id, item_id, replaced_at, mileage_km')
              .eq('vehicle_id', id)
              .order('replaced_at', { ascending: false })
              .limit(50),
            '교체 이력'
          ),
        ]);

        if (vehicleResult.error) {
          setErrorMessage(formatDbError(vehicleResult.error, '차량 정보를 불러오지 못했습니다.'));
          return;
        }
        const vData = vehicleResult.data as { vehicle_number: string; current_mileage_km: number | null };
        setVehicleNumber(vData.vehicle_number);
        setCurrentMileageKm(vData.current_mileage_km);
        navigation.setOptions({ title: `${vData.vehicle_number} 정비` });

        if (itemsResult.error) {
          setErrorMessage(formatDbError(itemsResult.error, '정비 항목을 불러오지 못했습니다.'));
          return;
        }
        setItems((itemsResult.data ?? []) as MaintenanceItem[]);

        if (recordsResult.error) {
          setErrorMessage(formatDbError(recordsResult.error, '정비 기록을 불러오지 못했습니다.'));
          return;
        }
        const recMap = new Map<string, VehicleMaintenance>();
        ((recordsResult.data ?? []) as (VehicleMaintenance & { item_id: string })[]).forEach((r) =>
          recMap.set(r.item_id, r)
        );
        setRecords(recMap);

        if (!historyResult.error) {
          const hMap = new Map<string, HistoryEntry[]>();
          ((historyResult.data ?? []) as (HistoryEntry & { item_id: string })[]).forEach((h) => {
            const existing = hMap.get(h.item_id) ?? [];
            if (existing.length < 5) existing.push(h);
            hMap.set(h.item_id, existing);
          });
          setHistory(hMap);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [id, navigation]
  );

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleUpdateMileage = useCallback(async () => {
    if (!id || isUpdatingMileage) return;
    const km = parseFloat(mileageUpdateInput.trim());
    if (!Number.isFinite(km) || km < 0) return;

    setIsUpdatingMileage(true);
    try {
      const { error } = await withTimeout(
        supabase.from('vehicles').update({ current_mileage_km: km }).eq('id', id),
        '주행거리 저장'
      );
      if (error) {
        setErrorMessage(formatDbError(error, '주행거리 저장 중 오류가 발생했습니다.'));
        return;
      }
      setCurrentMileageKm(km);
      setShowMileageForm(false);
      setMileageUpdateInput('');
    } finally {
      setIsUpdatingMileage(false);
    }
  }, [id, isUpdatingMileage, mileageUpdateInput]);

  const handleReplaceComplete = useCallback(
    async (item: MaintenanceItem) => {
      if (isSaving || !id) return;
      setIsSaving(true);
      setErrorMessage(null);

      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        const rawKm = mileageInput.trim();
        const mileageKm = rawKm ? parseFloat(rawKm) : currentMileageKm;

        let nextDueDateStr: string | null = null;
        if (item.standard_month > 0) {
          const nd = new Date(today);
          nd.setMonth(nd.getMonth() + item.standard_month);
          nextDueDateStr = nd.toISOString().split('T')[0];
        }
        const nextDueMileageKm =
          mileageKm != null && item.standard_km > 0 ? mileageKm + item.standard_km : null;

        const maintenancePayload = {
          vehicle_id: id,
          item_id: item.id,
          last_replaced_at: todayStr,
          last_replaced_mileage_km: mileageKm,
          next_due_date: nextDueDateStr,
          next_due_mileage_km: nextDueMileageKm,
          remaining_days: nextDueDateStr
            ? Math.floor((new Date(nextDueDateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
            : null,
          remaining_km:
            nextDueMileageKm != null && mileageKm != null ? nextDueMileageKm - mileageKm : null,
          status: 'ok',
          updated_at: new Date().toISOString(),
        };

        const historyPayload = {
          vehicle_id: id,
          item_id: item.id,
          replaced_at: todayStr,
          mileage_km: mileageKm,
        };

        const existing = records.get(item.id);
        const [maintenanceResult, historyResult] = await Promise.all([
          existing
            ? withTimeout(
                supabase.from('vehicle_maintenance').update(maintenancePayload).eq('id', existing.id),
                '교체 기록 저장'
              )
            : withTimeout(
                supabase.from('vehicle_maintenance').insert(maintenancePayload),
                '교체 기록 저장'
              ),
          withTimeout(
            supabase.from('vehicle_maintenance_history').insert(historyPayload),
            '교체 이력 저장'
          ),
        ]);

        const saveError = maintenanceResult.error ?? historyResult.error;
        if (saveError) {
          setErrorMessage(formatDbError(saveError, '교체 기록 저장 중 오류가 발생했습니다.'));
          return;
        }

        // 교체 시 입력한 km을 차량 현재 주행거리로도 업데이트
        if (mileageKm != null) {
          await withTimeout(
            supabase.from('vehicles').update({ current_mileage_km: mileageKm }).eq('id', id),
            '주행거리 동기화'
          );
          setCurrentMileageKm(mileageKm);
        }

        setExpandedItemId(null);
        setMileageInput('');
        await loadData(true);
      } catch (err) {
        setErrorMessage(formatDbError(err, '교체 기록 저장 중 오류가 발생했습니다.'));
      } finally {
        setIsSaving(false);
      }
    },
    [currentMileageKm, id, isSaving, loadData, mileageInput, records]
  );

  const statusCounts = items.reduce(
    (acc, item) => {
      const s = computeStatus(records.get(item.id) ?? null, item, currentMileageKm);
      return { ...acc, [s]: acc[s] + 1 };
    },
    { ok: 0, warning: 0, overdue: 0, unknown: 0 }
  );

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom + 96, 112) },
      ]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => loadData(true)} />}>
      <Text style={styles.title}>{vehicleNumber || '차량'} 정비 현황</Text>
      <Text style={styles.subtitle}>현대·기아 권장 교체 주기 기준</Text>

      {/* 오도미터 */}
      <View style={styles.odometerCard}>
        <View style={styles.odometerRow}>
          <View>
            <Text style={styles.odometerLabel}>현재 주행거리</Text>
            <Text style={styles.odometerValue}>
              {currentMileageKm != null ? `${currentMileageKm.toLocaleString()} km` : '미입력'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.odometerBtn}
            onPress={() => {
              setShowMileageForm(!showMileageForm);
              setMileageUpdateInput(currentMileageKm != null ? String(currentMileageKm) : '');
            }}>
            <Text style={styles.odometerBtnText}>{showMileageForm ? '취소' : '업데이트'}</Text>
          </TouchableOpacity>
        </View>
        {showMileageForm && (
          <View style={styles.odometerForm}>
            <TextInput
              style={styles.mileageInput}
              value={mileageUpdateInput}
              onChangeText={setMileageUpdateInput}
              placeholder="주행거리 입력 (km)"
              placeholderTextColor="#98A2B3"
              keyboardType="numeric"
              autoFocus
            />
            <TouchableOpacity
              accessibilityLabel="주행거리 저장"
              style={[styles.confirmBtn, isUpdatingMileage && styles.disabledBtn]}
              onPress={handleUpdateMileage}
              disabled={isUpdatingMileage}>
              <Text style={styles.confirmBtnText}>{isUpdatingMileage ? '저장 중...' : '저장'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 요약 */}
      <View style={styles.summaryGrid}>
        {([
          ['정상', statusCounts.ok, false, false],
          ['주의', statusCounts.warning, statusCounts.warning > 0, false],
          ['교체 필요', statusCounts.overdue, false, statusCounts.overdue > 0],
          ['미기록', statusCounts.unknown, false, false],
        ] as [string, number, boolean, boolean][]).map(([label, count, isWarn, isDanger]) => (
          <View key={label} style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text
              style={[
                styles.summaryValue,
                isWarn && styles.warningValue,
                isDanger && styles.dangerValue,
              ]}>
              {count}
            </Text>
          </View>
        ))}
      </View>

      {isLoading && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#1565C0" />
          <Text style={styles.noticeText}>정비 현황을 불러오는 중입니다.</Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.list}>
        {items.map((item) => {
          const record = records.get(item.id) ?? null;
          const status = computeStatus(record, item, currentMileageKm);
          const isExpanded = expandedItemId === item.id;
          const itemHistory = history.get(item.id) ?? [];
          const remainingDays = getRemainingDays(record?.next_due_date ?? null);
          const remainingKm = getRemainingKm(record?.next_due_mileage_km ?? null, currentMileageKm);

          return (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.cardHeader}>
                <Text
                  style={styles.itemName}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}>
                  {item.name}
                </Text>
                <StatusBadge status={status} />
              </View>

              <InfoRow
                label="교체 주기"
                value={
                  [
                    item.standard_month > 0 ? `${item.standard_month}개월` : '',
                    item.standard_km > 0 ? `${item.standard_km.toLocaleString()}km` : '',
                  ]
                    .filter(Boolean)
                    .join(' / ') || '-'
                }
              />
              <InfoRow
                label="마지막 교체"
                value={
                  record?.last_replaced_at
                    ? `${formatDateKr(record.last_replaced_at)}${record.last_replaced_mileage_km != null ? ` · ${record.last_replaced_mileage_km.toLocaleString()}km` : ''}`
                    : '미기록'
                }
              />
              <InfoRow
                label="다음 교체"
                value={
                  record?.next_due_date
                    ? `${formatDateKr(record.next_due_date)}${record.next_due_mileage_km != null ? ` · ${record.next_due_mileage_km.toLocaleString()}km` : ''}`
                    : '-'
                }
              />
              {remainingDays != null && (
                <InfoRow
                  label="남은 기간"
                  value={remainingDays < 0 ? `${Math.abs(remainingDays)}일 초과` : `${remainingDays}일`}
                />
              )}
              {remainingKm != null && (
                <InfoRow
                  label="남은 주행"
                  value={remainingKm < 0 ? `${Math.abs(Math.round(remainingKm)).toLocaleString()}km 초과` : `${Math.round(remainingKm).toLocaleString()}km`}
                />
              )}

              {/* 교체 이력 */}
              {itemHistory.length > 0 && (
                <View style={styles.historySection}>
                  <Text style={styles.historyTitle}>교체 이력</Text>
                  {itemHistory.map((h) => (
                    <View key={h.id} style={styles.historyRow}>
                      <Text style={styles.historyDate}>{formatDateKr(h.replaced_at)}</Text>
                      {h.mileage_km != null && (
                        <Text style={styles.historyKm}>{h.mileage_km.toLocaleString()}km</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* 교체 완료 버튼 / 폼 */}
              {isExpanded ? (
                <View style={styles.expandForm}>
                  <Text style={styles.formLabel}>
                    현재 주행거리 (km) — 선택
                    {currentMileageKm != null ? ` (현재 ${currentMileageKm.toLocaleString()}km)` : ''}
                  </Text>
                  <TextInput
                    style={styles.mileageInput}
                    value={mileageInput}
                    onChangeText={setMileageInput}
                    placeholder={
                      currentMileageKm != null ? `${currentMileageKm.toLocaleString()} (현재 값 사용)` : '예: 45000'
                    }
                    placeholderTextColor="#98A2B3"
                    keyboardType="numeric"
                    autoFocus
                  />
                  <View style={styles.formActions}>
                    <TouchableOpacity
                      accessibilityLabel={`${item.name} 교체 완료 확인`}
                      style={[styles.confirmBtn, isSaving && styles.disabledBtn]}
                      onPress={() => handleReplaceComplete(item)}
                      disabled={isSaving}>
                      <Text style={styles.confirmBtnText}>
                        {isSaving ? '저장 중...' : '교체 완료 확인'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => {
                        setExpandedItemId(null);
                        setMileageInput('');
                      }}
                      disabled={isSaving}>
                      <Text style={styles.cancelBtnText}>취소</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  accessibilityLabel={`${item.name} 교체 완료`}
                  style={[styles.replaceBtn, status === 'overdue' && styles.replaceBtnOverdue]}
                  onPress={() => {
                    setExpandedItemId(item.id);
                    setMileageInput('');
                  }}>
                  <Text
                    style={[styles.replaceBtnText, status === 'overdue' && styles.replaceBtnOverdueText]}>
                    교체 완료
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const configs: Record<ItemStatus, { label: string; bg: string; text: string }> = {
    ok:      { label: '정상',      bg: '#ECFDF5', text: '#059669' },
    warning: { label: '주의',      bg: '#FFFBEB', text: '#D97706' },
    overdue: { label: '교체 필요', bg: '#FEF2F2', text: '#DC2626' },
    unknown: { label: '미기록',    bg: '#F1F5F9', text: '#64748B' },
  };
  const { label, bg, text } = configs[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: text }]}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8FAFC',
    flexGrow: 1,
    padding: 20,
    paddingTop: 24,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
  },
  odometerCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    marginBottom: 14,
    padding: 16,
  },
  odometerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  odometerLabel: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  odometerValue: {
    color: '#1E3A8A',
    fontSize: 20,
    fontWeight: '700',
  },
  odometerBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  odometerBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  odometerForm: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  summaryValue: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
  },
  warningValue: { color: '#D97706' },
  dangerValue: { color: '#DC2626' },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: { color: '#1D4ED8', flex: 1, fontSize: 14, fontWeight: '500' },
  errorBox: { backgroundColor: '#FEF2F2', borderRadius: 12, marginBottom: 14, padding: 14 },
  errorText: { color: '#DC2626', fontSize: 14, fontWeight: '500' },
  list: { gap: 12 },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  itemName: { color: '#0F172A', flex: 1, fontSize: 16, fontWeight: '700', marginRight: 8, minWidth: 0 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 28,
  },
  infoLabel: { color: '#64748B', fontSize: 13, fontWeight: '500' },
  infoValue: {
    color: '#334155',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 14,
    textAlign: 'right',
  },
  historySection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    marginTop: 10,
    padding: 10,
  },
  historyTitle: { color: '#64748B', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  historyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  historyDate: { color: '#334155', fontSize: 12, fontWeight: '500' },
  historyKm: { color: '#64748B', fontSize: 12, fontWeight: '500' },
  replaceBtn: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  replaceBtnOverdue: { backgroundColor: '#2563EB' },
  replaceBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '600' },
  replaceBtnOverdueText: { color: '#FFFFFF' },
  expandForm: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    marginTop: 12,
    padding: 14,
  },
  formLabel: { color: '#64748B', fontSize: 13, fontWeight: '500', marginBottom: 8 },
  mileageInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    color: '#0F172A',
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  formActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  confirmBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    flexBasis: 160,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  confirmBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  cancelBtn: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    flexBasis: 80,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  cancelBtnText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  disabledBtn: { opacity: 0.4 },
});
