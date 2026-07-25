import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { useRoleGuard } from '@/hooks/use-role-guard';
import { buildEcuAlertRules } from '@/lib/ecu-alert-rules';
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
import { loadSyncedObdSnapshot, type ObdReading, type ObdSnapshot } from '@/lib/obd-data';
import { loadSelectedObdBleDevice, obdBle, saveSelectedObdBleDevice, scanForObdBleDevices } from '@/lib/obd-ble';
import { fetchLatestVehicleOdometers, fetchVehiclesReadOnly, type VehicleSummary } from '@/lib/readonly-data';

type Severity = 'bad' | 'warn';

type MaintenanceAlert = {
  kind: 'maintenance';
  id: string;
  severity: Severity;
  vehicle: VehicleSummary;
  item: MaintenanceItem;
  remainingKm: number;
};

type EcuAlert = {
  kind: 'ecu';
  id: string;
  fingerprint: string;
  severity: Severity;
  vehicle: VehicleSummary;
  title: string;
  value: string;
  detail: string;
};

type OverviewTone = 'bad' | 'warn' | 'no-data' | 'ok';

const ACK_STORAGE_KEY = 'vehicle-ecu-alert-acks-v1';
const PART_COLORS = ['#EAFBF4', '#FFF4DE', '#EAF7FA'];
const FOCUSED_REFRESH_MS = 5_000;

const OVERVIEW_ICON: Record<OverviewTone, string> = { bad: '🔴', warn: '🟡', 'no-data': '⚫', ok: '🟢' };
const OVERVIEW_COLOR: Record<OverviewTone, string> = { bad: '#E11D48', warn: '#D97706', 'no-data': '#94A3B8', ok: '#15803D' };

function formatKm(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}km`;
}

function remainingLabel(value: number) {
  if (value <= 0) return `${Math.abs(value).toLocaleString('ko-KR')}km 초과`;
  return `${value.toLocaleString('ko-KR')}km 남음`;
}

function buildEcuAlerts(vehicle: VehicleSummary, reading: ObdReading | undefined): EcuAlert[] {
  if (!reading) return [];
  return buildEcuAlertRules(reading).map((alert) => {
    const fingerprint = `${vehicle.id}:${alert.key}:${alert.value}`;
    return { kind: 'ecu' as const, id: fingerprint, fingerprint, severity: alert.severity as Severity, vehicle, title: alert.title, value: alert.value, detail: alert.detail };
  });
}

async function loadAcknowledgedFingerprints(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(ACK_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function saveAcknowledgedFingerprints(items: Set<string>) {
  await AsyncStorage.setItem(ACK_STORAGE_KEY, JSON.stringify([...items]));
}

export default function AlertsScreen() {
  useRoleGuard(['commander', 'admin']);

  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [maintenanceSnapshot, setMaintenanceSnapshot] = useState<MaintenanceSnapshot>({});
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completionModal, setCompletionModal] = useState<{
    vehicle: VehicleSummary;
    item: MaintenanceItem;
    currentKm: number | null;
    remainingKm: number | null;
  } | null>(null);
  const [completionKmText, setCompletionKmText] = useState('');
  const [kmInputText, setKmInputText] = useState('');
  const [obdConnectStatus, setObdConnectStatus] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const obdConnectInFlightRef = useRef(false);

  const loadData = useCallback(async (showLoading = true) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (showLoading) setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextVehicles = await fetchVehiclesReadOnly(200);
      const vehicleIds = nextVehicles.map((v) => v.id);
      const [maintenanceResult, obdResult, odometers, ackSet] = await Promise.all([
        loadSyncedMaintenanceSnapshot(vehicleIds),
        loadSyncedObdSnapshot(vehicleIds),
        fetchLatestVehicleOdometers(vehicleIds),
        loadAcknowledgedFingerprints(),
      ]);
      const mergedMaintenance = await mergeVehicleCurrentKm(maintenanceResult.snapshot, odometers);
      setVehicles(nextVehicles);
      setSelectedVehicleId((current) => current);
      setMaintenanceSnapshot(mergedMaintenance);
      setObdSnapshot(obdResult.snapshot);
      setAcknowledged(ackSet);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '알림 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      void loadData(false);
      const refreshId = setInterval(() => { void loadData(false); }, FOCUSED_REFRESH_MS);
      return () => clearInterval(refreshId);
    }, [loadData])
  );

  const alerts = useMemo(() => {
    const maintenanceAlerts: MaintenanceAlert[] = vehicles.flatMap((vehicle) => {
      const state = getVehicleMaintenanceState(maintenanceSnapshot, vehicle.id);
      return MAINTENANCE_ITEMS.flatMap((item) => {
        const remainingKm = getRemainingKm(state, item);
        if (remainingKm === null || remainingKm > 1000) return [];
        return [{
          kind: 'maintenance' as const,
          id: `${vehicle.id}:${item.key}`,
          severity: remainingKm <= 0 ? 'bad' as const : 'warn' as const,
          vehicle,
          item,
          remainingKm,
        }];
      });
    });
    const ecuAlerts = vehicles
      .flatMap((vehicle) => buildEcuAlerts(vehicle, obdSnapshot[vehicle.id]))
      .filter((item) => !acknowledged.has(item.fingerprint));
    return [...maintenanceAlerts, ...ecuAlerts].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'bad' ? -1 : 1;
      return a.vehicle.vehicleNumber.localeCompare(b.vehicle.vehicleNumber, 'ko-KR');
    });
  }, [acknowledged, maintenanceSnapshot, obdSnapshot, vehicles]);

  // 개선 A: 전체 차량 교환주기 현황 (urgency 순 정렬)
  const vehicleOverview = useMemo(() =>
    vehicles.map((vehicle) => {
      const state = getVehicleMaintenanceState(maintenanceSnapshot, vehicle.id);
      const hasData = state.currentKm !== null;
      const worstItem = MAINTENANCE_ITEMS.reduce<{ item: MaintenanceItem; remaining: number } | null>((acc, item) => {
        const remaining = getRemainingKm(state, item);
        if (remaining === null) return acc;
        if (acc === null || remaining < acc.remaining) return { item, remaining };
        return acc;
      }, null);
      const tone: OverviewTone = !hasData ? 'no-data'
        : worstItem === null ? 'ok'
        : worstItem.remaining <= 0 ? 'bad'
        : worstItem.remaining <= 1000 ? 'warn'
        : 'ok';
      return { vehicle, worstItem, tone };
    }).sort((a, b) => {
      const order: Record<OverviewTone, number> = { bad: 0, warn: 1, 'no-data': 2, ok: 3 };
      return order[a.tone] - order[b.tone];
    }),
    [vehicles, maintenanceSnapshot]
  );

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) ?? null,
    [selectedVehicleId, vehicles]
  );
  const selectedState = selectedVehicle ? getVehicleMaintenanceState(maintenanceSnapshot, selectedVehicle.id) : null;

  // 차량 전환 시 현재 km 자동 채우기
  useEffect(() => {
    setKmInputText(selectedState?.currentKm != null ? String(selectedState.currentKm) : '');
  }, [selectedVehicleId, selectedState?.currentKm]);

  // 차량 선택 시 OBD 단말기 자동 검색 및 연결
  useEffect(() => {
    if (!selectedVehicleId) {
      setObdConnectStatus(null);
      return;
    }
    if (obdConnectInFlightRef.current) return;
    obdConnectInFlightRef.current = true;
    setObdConnectStatus('단말기 검색 중');

    (async () => {
      try {
        let device = await loadSelectedObdBleDevice();
        if (!device) {
          const scan = await scanForObdBleDevices();
          if (scan.ok && scan.devices.length > 0) {
            device = scan.devices.find((d) => /vlink|obd|elm/i.test(d.name)) ?? scan.devices[0];
            await saveSelectedObdBleDevice(device);
          }
        }
        if (!device) {
          setObdConnectStatus('단말기 미검색');
          return;
        }
        setObdConnectStatus(`${device.name} 연결 중`);
        const result = await obdBle.connect(device.id);
        if (result.ok) {
          obdBle.startPolling(2000);
          setObdConnectStatus('연결완료');
        } else {
          setObdConnectStatus('연결 실패');
        }
      } catch {
        setObdConnectStatus('연결 실패');
      } finally {
        obdConnectInFlightRef.current = false;
      }
    })();
  }, [selectedVehicleId]);

  const maintenanceCards = selectedVehicle && selectedState
    ? MAINTENANCE_ITEMS.map((item) => {
        const remainingKm = getRemainingKm(selectedState, item);
        const lastReplacedKm = selectedState.completedKm[item.key];
        return {
          item,
          title: item.label,
          remainingValue: remainingKm === null ? '현재 km 필요' : remainingLabel(remainingKm),
          lastReplacedKm,
          detail: `${item.intervalKm.toLocaleString('ko-KR')}km 주기`,
          tone: remainingKm !== null && remainingKm <= 0 ? 'bad' : remainingKm !== null && remainingKm <= 1000 ? 'warn' : 'ok',
        };
      })
    : [];

  function openCompletionModal(vehicle: VehicleSummary, item: MaintenanceItem) {
    const state = getVehicleMaintenanceState(maintenanceSnapshot, vehicle.id);
    const defaultKm = state.currentKm ?? state.completedKm[item.key] ?? null;
    setCompletionModal({ vehicle, item, currentKm: state.currentKm, remainingKm: getRemainingKm(state, item) });
    setCompletionKmText(defaultKm !== null ? String(defaultKm) : '');
  }

  async function handleConfirmCompletion() {
    if (!completionModal) return;
    const km = parseInt(completionKmText.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(km) || km <= 0) {
      Alert.alert('입력 오류', '교체 당시 계기판 km을 입력해 주세요.');
      return;
    }
    setCompletionModal(null);
    setIsSaving(true);
    try {
      const nextSnapshot = await completeMaintenanceItem(completionModal.vehicle.id, completionModal.item.key, km);
      setMaintenanceSnapshot(nextSnapshot);
      await syncMaintenanceCompletion(completionModal.vehicle.id, completionModal.item.key, km);
      Alert.alert('교체 완료', `${completionModal.vehicle.vehicleNumber} · ${completionModal.item.label}\n교체 km ${formatKm(km)}`);
    } catch (error) {
      Alert.alert('교체 기록 실패', error instanceof Error ? error.message : '교체 기록을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAcknowledgeEcu(alertItem: EcuAlert) {
    const next = new Set(acknowledged);
    next.add(alertItem.fingerprint);
    setAcknowledged(next);
    await saveAcknowledgedFingerprints(next);
    Alert.alert('점검 완료', `${alertItem.vehicle.vehicleNumber} · ${alertItem.title}\n값이 바뀌면 다시 알림에 표시됩니다.`);
  }

  // 개선 B: 정비탭에서 km 직접 설정
  async function handleSaveCurrentKm() {
    const km = parseInt(kmInputText.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(km) || km <= 0) {
      Alert.alert('입력 오류', '현재 계기판 km를 입력해 주세요.');
      return;
    }
    if (!selectedVehicle) return;
    setIsSaving(true);
    try {
      const nextSnapshot = await setVehicleCurrentKm(selectedVehicle.id, km);
      setMaintenanceSnapshot(nextSnapshot);
    } catch (error) {
      Alert.alert('저장 실패', error instanceof Error ? error.message : '저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RebuildScreen
      title="정비"
      subtitle="교환 알림과 차량별 정비 설정"
      bottomSpace="compact"
      metrics={[
        { label: '교환 필요', value: `${alerts.filter((a) => a.kind === 'maintenance' && a.severity === 'bad').length}건` },
        { label: '점검 알림', value: `${alerts.filter((a) => a.kind === 'ecu').length}건` },
        { label: '전체 알림', value: `${alerts.length}건` },
        { label: '등록 차량', value: `${vehicles.length}대` },
      ]}>

      {isLoading ? (
        <LoadingCard label="알림 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : (
        <>
          {/* 개선 A: 전체 차량 현황 한눈에 */}
          {vehicleOverview.length > 0 ? (
            <SectionCard title="전체 차량 현황">
              <View style={styles.overviewList}>
                {vehicleOverview.map(({ vehicle, worstItem, tone }) => {
                  const obd = obdSnapshot[vehicle.id];
                  const ecuTime = obd ? obd.recordedAt.slice(5, 16).replace('T', ' ') : null;
                  return (
                    <Pressable
                      key={vehicle.id}
                      style={[styles.overviewRow, selectedVehicleId === vehicle.id && styles.overviewRowSelected]}
                      onPress={() => setSelectedVehicleId(vehicle.id)}>
                      <Text style={styles.overviewIcon}>{OVERVIEW_ICON[tone]}</Text>
                      <Text style={styles.overviewVehicle}>{vehicle.vehicleNumber}</Text>
                      <View style={styles.overviewRight}>
                        <Text style={[styles.overviewStatus, { color: OVERVIEW_COLOR[tone] }]}>
                          {tone === 'no-data'
                            ? 'km 미설정'
                            : worstItem === null
                            ? '정상'
                            : `${worstItem.item.label} ${remainingLabel(worstItem.remaining)}`}
                        </Text>
                        {ecuTime ? <Text style={styles.overviewEcu}>ECU {ecuTime}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </SectionCard>
          ) : (
            <SectionCard title="차량 없음" body="등록된 차량이 없습니다." />
          )}

          {/* 알림 목록 */}
          {alerts.length > 0 ? (
            <SectionCard title={`알림 ${alerts.length}건`}>
              <View style={styles.list}>
                {alerts.map((item) => (
                  <View key={item.id} style={[styles.alertCard, item.severity === 'bad' ? styles.badCard : styles.warnCard]}>
                    <View style={styles.alertTop}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.kind === 'maintenance' ? '교환' : '점검'}</Text>
                      </View>
                      <Text style={styles.vehicleText}>{item.vehicle.vehicleNumber}</Text>
                    </View>
                    <Text style={styles.alertTitle}>
                      {item.kind === 'maintenance' ? item.item.label : item.title}
                    </Text>
                    <Text style={styles.alertDetail}>
                      {item.kind === 'maintenance'
                        ? `${remainingLabel(item.remainingKm)} · ${item.item.intervalKm.toLocaleString('ko-KR')}km 주기`
                        : `${item.value} · ${item.detail}`}
                    </Text>
                    <Pressable
                      style={styles.completeButton}
                      onPress={() => item.kind === 'maintenance' ? openCompletionModal(item.vehicle, item.item) : void handleAcknowledgeEcu(item)}
                      disabled={isSaving}>
                      <Text style={styles.completeButtonText}>{item.kind === 'maintenance' ? '교체완료' : '점검완료'}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </SectionCard>
          ) : (
            <SectionCard title="현재 알림 없음" body="교체주기가 임박했거나 ECU 기준치를 벗어난 차량이 없습니다." />
          )}

          {/* 차량 정비 설정 */}
          {vehicles.length > 0 ? (
            <SectionCard title="차량 정비 설정">
              <VehicleDropdown
                vehicles={vehicles}
                selectedVehicleId={selectedVehicleId}
                onSelect={setSelectedVehicleId}
                placeholder="차량 선택"
              />
              {obdConnectStatus ? (
                <StatusLine label="단말기" value={obdConnectStatus} />
              ) : null}
              {selectedVehicle && selectedState ? (
                <>
                  <StatusLine
                    label="현재 기준"
                    value={selectedState.currentKm === null ? '미설정' : formatKm(selectedState.currentKm)}
                  />

                  {/* 개선 B: 계기판 km 직접 입력 */}
                  <View style={styles.kmRow}>
                    <TextInput
                      style={styles.kmInput}
                      value={kmInputText}
                      onChangeText={setKmInputText}
                      keyboardType="numeric"
                      placeholder="계기판 km 직접 입력"
                      placeholderTextColor="#94A3B8"
                      returnKeyType="done"
                      onSubmitEditing={() => void handleSaveCurrentKm()}
                    />
                    <Pressable style={styles.kmSaveBtn} onPress={() => void handleSaveCurrentKm()} disabled={isSaving}>
                      <Text style={styles.kmSaveBtnText}>{isSaving ? '저장 중' : '기준 설정'}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.kmHint}>운행탭 출발 계기판 입력 시 자동 반영 · 여기서 직접 입력도 가능</Text>

                  <Text style={styles.settingsTitle}>주기성 교환품목</Text>
                  <View style={styles.grid}>
                    {maintenanceCards.map((card, index) => (
                      <View
                        key={card.item.key}
                        style={[
                          styles.maintenanceCard,
                          { backgroundColor: PART_COLORS[index % PART_COLORS.length] },
                          card.tone === 'bad' && styles.badCard,
                          card.tone === 'warn' && styles.warnCard,
                        ]}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                        <View style={styles.trackBlock}>
                          <Text style={styles.trackLabel}>잔여</Text>
                          <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>{card.remainingValue}</Text>
                        </View>
                        <View style={styles.trackBlock}>
                          <Text style={styles.trackLabel}>교체</Text>
                          <Text style={styles.cardReplace} numberOfLines={1}>
                            {card.lastReplacedKm !== undefined ? formatKm(card.lastReplacedKm) : '이력 없음'}
                          </Text>
                        </View>
                        <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                        <Pressable
                          style={styles.cardAction}
                          onPress={() => openCompletionModal(selectedVehicle, card.item)}
                          disabled={isSaving}>
                          <Text style={styles.cardActionText}>교체완료</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </SectionCard>
          ) : null}
        </>
      )}

      {/* 개선 C: 교체완료 시 계기판 km 입력 모달 */}
      <Modal visible={completionModal !== null} transparent animationType="fade" onRequestClose={() => setCompletionModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCompletionModal(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>교체 완료 기록</Text>
            {completionModal ? (
              <>
                <Text style={styles.modalSub}>{completionModal.vehicle.vehicleNumber} · {completionModal.item.label}</Text>
                <View style={styles.modalRefRow}>
                  <Text style={styles.modalRefText}>
                    현재 기준: {completionModal.currentKm !== null ? formatKm(completionModal.currentKm) : '미설정'}
                  </Text>
                  {completionModal.remainingKm !== null ? (
                    <Text style={[styles.modalRefText, completionModal.remainingKm <= 0 && { color: '#E11D48' }]}>
                      잔여: {remainingLabel(completionModal.remainingKm)}
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}
            <Text style={styles.modalInputLabel}>교체 당시 계기판 km</Text>
            <TextInput
              style={styles.modalInput}
              value={completionKmText}
              onChangeText={setCompletionKmText}
              keyboardType="numeric"
              placeholder="예: 45000"
              placeholderTextColor="#94A3B8"
              returnKeyType="done"
              onSubmitEditing={() => void handleConfirmCompletion()}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setCompletionModal(null)}>
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={styles.modalConfirmBtn} onPress={() => void handleConfirmCompletion()} disabled={isSaving}>
                <Text style={styles.modalConfirmText}>확인</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  // 전체 차량 현황 (개선 A)
  overviewList: { gap: 2, marginTop: 8 },
  overviewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10, gap: 10 },
  overviewRowSelected: { backgroundColor: '#EFF6FF' },
  overviewIcon: { fontSize: 14 },
  overviewVehicle: { color: '#0F172A', fontSize: 14, fontWeight: '800', minWidth: 90 },
  overviewRight: { flex: 1, alignItems: 'flex-end', gap: 2 },
  overviewStatus: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  overviewEcu: { color: '#94A3B8', fontSize: 10, fontWeight: '500', textAlign: 'right' },

  // km 직접 입력 (개선 B)
  kmRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  kmInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    backgroundColor: '#F0F7FF',
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  kmSaveBtn: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  kmSaveBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  kmHint: { color: '#94A3B8', fontSize: 10, fontWeight: '600', marginTop: 4, marginBottom: 2 },

  // 알림 목록
  list: { gap: 10, marginTop: 10 },
  alertCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#A7B0D8',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  badCard: { backgroundColor: '#FFF1F2', borderColor: '#FFD0D6' },
  warnCard: { backgroundColor: '#FFF8E7', borderColor: '#FFE7AC' },
  alertTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  badge: { borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: '#4F6AE6', fontSize: 11, fontWeight: '900' },
  vehicleText: { color: '#1E2946', fontSize: 14, fontWeight: '900' },
  alertTitle: { color: '#111827', fontSize: 20, fontWeight: '900', marginTop: 12 },
  alertDetail: { color: '#52607D', fontSize: 13, fontWeight: '800', lineHeight: 18, marginTop: 6 },
  completeButton: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  completeButtonText: { color: '#4F6AE6', fontSize: 14, fontWeight: '900' },

  // 교환품목 카드
  settingsTitle: { color: '#13866F', fontSize: 18, fontWeight: '900', marginTop: 18, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  maintenanceCard: {
    width: '48%',
    minHeight: 140,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    padding: 10,
    justifyContent: 'space-between',
  },
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
  trackBlock: { flexDirection: 'column', gap: 1, marginTop: 2 },
  trackLabel: { fontSize: 9, fontWeight: '900', color: '#7180A3' },
  cardReplace: { fontSize: 11, fontWeight: '800', color: '#52607D', flexShrink: 1 },

  // 교체완료 모달 (개선 C)
  modalRefRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  modalRefText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  modalSub: { fontSize: 13, fontWeight: '700', color: '#52607D', marginBottom: 6 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: {
    width: '82%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#2563EB',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 4 },
  modalInputLabel: { fontSize: 12, fontWeight: '800', color: '#64748B', marginBottom: 6 },
  modalInput: {
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    backgroundColor: '#F0F7FF',
    marginBottom: 20,
  },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: { color: '#64748B', fontSize: 15, fontWeight: '800' },
  modalConfirmBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});
