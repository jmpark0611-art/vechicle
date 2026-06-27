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

function getItemEmoji(name: string): string {
  if (name.includes('엔진') || name.includes('오일')) return '⛽';
  if (name.includes('타이어')) return '🛞';
  if (name.includes('브레이크')) return '🧰';
  if (name.includes('배터리')) return '🔋';
  if (name.includes('와이퍼')) return '🧽';
  if (name.includes('필터')) return '🌬️';
  return '🔧';
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
      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <Text style={styles.heroEmoji}>🚗</Text>
        </View>
        <View style={styles.heroTextBox}>
          <Text style={styles.heroEyebrow}>차량 정비</Text>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
            {vehicleNumber || '차량'}
          </Text>
          <Text style={styles.subtitle}>교체완료 시점부터 다음 알림을 다시 계산합니다.</Text>
        </View>
      </View>

      {/* 오도미터 */}
      <View style={styles.odometerCard}>
        <View style={styles.odometerRow}>
          <View style={styles.odometerTextBox}>
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
          ['✅', '정상', statusCounts.ok, false, false],
          ['⚡', '주의', statusCounts.warning, statusCounts.warning > 0, false],
          ['🚨', '교체 필요', statusCounts.overdue, false, statusCounts.overdue > 0],
          ['📝', '미기록', statusCounts.unknown, false, false],
        ] as [string, string, number, boolean, boolean][]).map(([emoji, label, count, isWarn, isDanger]) => (
          <View key={label} style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>{emoji}</Text>
            <View>
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
                <View style={styles.itemTitleWrap}>
                  <View style={styles.itemIcon}>
                    <Text style={styles.itemEmoji}>{getItemEmoji(item.name)}</Text>
                  </View>
                  <Text
                    style={styles.itemName}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}>
                    {item.name}
                  </Text>
                </View>
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
  const configs: Record<ItemStatus, { label: string; icon: string; bg: string; text: string }> = {
    ok:      { label: '정상',      icon: '✓', bg: '#183F28', text: '#A8FF5F' },
    warning: { label: '주의',      icon: '!', bg: '#4A3A12', text: '#FFD65C' },
    overdue: { label: '교체 필요', icon: '!', bg: '#4A1C1C', text: '#FF8585' },
    unknown: { label: '미기록',    icon: '-', bg: '#2F3440', text: '#C8D1DF' },
  };
  const { label, icon, bg, text } = configs[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: text }]}>{icon} {label}</Text>
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
    backgroundColor: '#101314',
    flexGrow: 1,
    padding: 18,
    paddingTop: 24,
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
    padding: 16,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#0A0B0A',
    borderColor: '#80FF2F',
    borderRadius: 18,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  heroEmoji: {
    fontSize: 30,
  },
  heroTextBox: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    color: '#A8FF5F',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
  },
  subtitle: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 4,
  },
  odometerCard: {
    backgroundColor: '#18351F',
    borderColor: '#29552F',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  odometerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  odometerTextBox: {
    flex: 1,
    minWidth: 0,
  },
  odometerLabel: {
    color: '#A8FF5F',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 2,
  },
  odometerValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  odometerBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  odometerBtnText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
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
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#2B312E',
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  summaryEmoji: {
    fontSize: 24,
  },
  summaryLabel: {
    color: '#A6ADB8',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  summaryValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  warningValue: { color: '#FFD65C' },
  dangerValue: { color: '#FF8585' },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: { color: '#A8FF5F', flex: 1, fontSize: 14, fontWeight: '800' },
  errorBox: { backgroundColor: '#3A1C1C', borderRadius: 12, marginBottom: 14, padding: 14 },
  errorText: { color: '#FF8585', fontSize: 14, fontWeight: '800' },
  list: { gap: 12 },
  itemCard: {
    backgroundColor: '#232326',
    borderColor: '#30343A',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  itemTitleWrap: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  itemIcon: {
    alignItems: 'center',
    backgroundColor: '#080A08',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  itemEmoji: {
    fontSize: 25,
  },
  itemName: { color: '#FFFFFF', flex: 1, fontSize: 17, fontWeight: '900', marginRight: 8, minWidth: 0 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '900' },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 28,
  },
  infoLabel: { color: '#A6ADB8', fontSize: 13, fontWeight: '800' },
  infoValue: {
    color: '#E6EBF2',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 14,
    textAlign: 'right',
  },
  historySection: {
    backgroundColor: '#181A1D',
    borderRadius: 10,
    marginTop: 10,
    padding: 10,
  },
  historyTitle: { color: '#A8FF5F', fontSize: 12, fontWeight: '900', marginBottom: 6 },
  historyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  historyDate: { color: '#E6EBF2', fontSize: 12, fontWeight: '700' },
  historyKm: { color: '#A6ADB8', fontSize: 12, fontWeight: '700' },
  replaceBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  replaceBtnOverdue: { backgroundColor: '#FF8585' },
  replaceBtnText: { color: '#111827', fontSize: 14, fontWeight: '900' },
  replaceBtnOverdueText: { color: '#111827' },
  expandForm: {
    backgroundColor: '#181A1D',
    borderRadius: 12,
    marginTop: 12,
    padding: 14,
  },
  formLabel: { color: '#A6ADB8', fontSize: 13, fontWeight: '800', marginBottom: 8 },
  mileageInput: {
    backgroundColor: '#101314',
    borderColor: '#3D444D',
    borderRadius: 10,
    borderWidth: 1,
    color: '#FFFFFF',
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
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
    backgroundColor: '#A8FF5F',
    borderRadius: 10,
    flexBasis: 160,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  confirmBtnText: { color: '#111827', fontSize: 14, fontWeight: '900' },
  cancelBtn: {
    alignItems: 'center',
    backgroundColor: '#2F3440',
    borderRadius: 10,
    flexBasis: 80,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  cancelBtnText: { color: '#E6EBF2', fontSize: 14, fontWeight: '900' },
  disabledBtn: { opacity: 0.4 },
});
