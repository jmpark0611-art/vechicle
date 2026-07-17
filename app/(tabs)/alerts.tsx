import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import {
  completeMaintenanceItem,
  getRemainingKm,
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  MAINTENANCE_ITEMS,
  mergeVehicleCurrentKm,
  syncMaintenanceCompletion,
  type MaintenanceItem,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import { loadSyncedObdSnapshot, type ObdReading, type ObdSnapshot } from '@/lib/obd-data';
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

const ACK_STORAGE_KEY = 'vehicle-ecu-alert-acks-v1';
const PART_COLORS = ['#EAFBF4', '#FFF4DE', '#EAF7FA'];

function formatKm(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}km`;
}

function remainingLabel(value: number) {
  if (value <= 0) return `${Math.abs(value).toLocaleString('ko-KR')}km 초과`;
  return `${value.toLocaleString('ko-KR')}km 남음`;
}

function maintenanceLabel(item: MaintenanceItem) {
  return item.label;
}

function numberLabel(value: number, suffix: string) {
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function addEcuAlert(
  alerts: EcuAlert[],
  vehicle: VehicleSummary,
  reading: ObdReading,
  key: string,
  severity: Severity,
  title: string,
  value: string,
  detail: string
) {
  const fingerprint = `${vehicle.id}:${key}:${value}`;
  alerts.push({
    kind: 'ecu',
    id: fingerprint,
    fingerprint,
    severity,
    vehicle,
    title,
    value,
    detail,
  });
}

function buildEcuAlerts(vehicle: VehicleSummary, reading: ObdReading | undefined): EcuAlert[] {
  if (!reading) return [];

  const alerts: EcuAlert[] = [];
  if (reading.dtcCount !== null && reading.dtcCount > 0) {
    addEcuAlert(alerts, vehicle, reading, 'dtc', 'bad', '고장 코드', `${reading.dtcCount}건`, 'DTC 점검 필요');
  }
  if (reading.coolantTempC !== null && reading.coolantTempC >= 105) {
    addEcuAlert(alerts, vehicle, reading, 'coolant', 'bad', '냉각수 온도', numberLabel(reading.coolantTempC, '°C'), '105°C 이상');
  }
  if (reading.batteryVoltage !== null && (reading.batteryVoltage < 12 || reading.batteryVoltage > 15)) {
    addEcuAlert(alerts, vehicle, reading, 'battery', 'warn', '배터리 전압', numberLabel(reading.batteryVoltage, 'V'), '정상 범위 12~15V');
  }
  if (reading.fuelPercent !== null && reading.fuelPercent <= 15) {
    addEcuAlert(alerts, vehicle, reading, 'fuel', 'warn', '연료 잔량', `${reading.fuelPercent}%`, '15% 이하');
  }
  if (reading.engineLoadPercent !== null && reading.engineLoadPercent >= 90) {
    addEcuAlert(alerts, vehicle, reading, 'engine-load', 'warn', '엔진 부하', `${reading.engineLoadPercent}%`, '90% 이상 지속 여부 확인');
  }
  if (reading.shortFuelTrimPercent !== null && Math.abs(reading.shortFuelTrimPercent) >= 20) {
    addEcuAlert(alerts, vehicle, reading, 'short-trim', 'warn', '단기 연료트림', `${reading.shortFuelTrimPercent}%`, '혼합비 보정값 과다');
  }
  if (reading.longFuelTrimPercent !== null && Math.abs(reading.longFuelTrimPercent) >= 20) {
    addEcuAlert(alerts, vehicle, reading, 'long-trim', 'warn', '장기 연료트림', `${reading.longFuelTrimPercent}%`, '혼합비 보정값 과다');
  }
  if (reading.readinessSummary && reading.readinessSummary !== '준비 완료') {
    addEcuAlert(alerts, vehicle, reading, 'readiness', 'warn', '배출가스 준비상태', reading.readinessSummary, '검사 항목 준비 미완료');
  }

  return alerts;
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
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [maintenanceSnapshot, setMaintenanceSnapshot] = useState<MaintenanceSnapshot>({});
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextVehicles = await fetchVehiclesReadOnly(200);
      const vehicleIds = nextVehicles.map((vehicle) => vehicle.id);
      const [maintenanceResult, obdResult, odometers, ackSet] = await Promise.all([
        loadSyncedMaintenanceSnapshot(vehicleIds),
        loadSyncedObdSnapshot(vehicleIds),
        fetchLatestVehicleOdometers(vehicleIds),
        loadAcknowledgedFingerprints(),
      ]);
      const mergedMaintenance = await mergeVehicleCurrentKm(maintenanceResult.snapshot, odometers);
      setVehicles(nextVehicles);
      setSelectedVehicleId((current) => current ?? nextVehicles[0]?.id ?? null);
      setMaintenanceSnapshot(mergedMaintenance);
      setObdSnapshot(obdResult.snapshot);
      setAcknowledged(ackSet);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '알림 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null,
    [selectedVehicleId, vehicles]
  );
  const selectedState = selectedVehicle ? getVehicleMaintenanceState(maintenanceSnapshot, selectedVehicle.id) : null;
  const selectedObd = selectedVehicle ? obdSnapshot[selectedVehicle.id] : null;
  const maintenanceCards = selectedVehicle && selectedState
    ? MAINTENANCE_ITEMS.map((item) => {
        const remainingKm = getRemainingKm(selectedState, item);
        return {
          item,
          title: maintenanceLabel(item),
          value: remainingKm === null ? '현재 km 필요' : remainingLabel(remainingKm),
          detail: `${item.intervalKm.toLocaleString('ko-KR')}km 주기`,
          tone: remainingKm !== null && remainingKm <= 0 ? 'bad' : remainingKm !== null && remainingKm <= 1000 ? 'warn' : 'ok',
        };
      })
    : [];

  async function handleCompleteMaintenance(alertItem: MaintenanceAlert) {
    const state = getVehicleMaintenanceState(maintenanceSnapshot, alertItem.vehicle.id);
    if (state.currentKm === null) {
      Alert.alert('현재 km 필요', '진단 탭에서 차량의 현재 계기판 기준을 먼저 저장해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const nextSnapshot = await completeMaintenanceItem(alertItem.vehicle.id, alertItem.item.key, state.currentKm);
      setMaintenanceSnapshot(nextSnapshot);
      await syncMaintenanceCompletion(alertItem.vehicle.id, alertItem.item.key, state.currentKm);
      Alert.alert('교체 완료', `${alertItem.vehicle.vehicleNumber} · ${maintenanceLabel(alertItem.item)}\n기준 ${formatKm(state.currentKm)}`);
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

  return (
    <RebuildScreen
      title="정비"
      subtitle="교환 알림과 차량별 정비 설정"
      bottomSpace="compact"
      metrics={[
        { label: '전체 알림', value: `${alerts.length}건` },
        { label: '정비 필요', value: `${alerts.filter((item) => item.severity === 'bad').length}건` },
      ]}>
      {isLoading ? (
        <LoadingCard label="알림 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : alerts.length === 0 ? (
        <SectionCard title="현재 알림 없음" body="교체주기가 임박했거나 ECU 기준치를 벗어난 차량이 없습니다." />
      ) : (
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
                  {item.kind === 'maintenance' ? maintenanceLabel(item.item) : item.title}
                </Text>
                <Text style={styles.alertDetail}>
                  {item.kind === 'maintenance'
                    ? `${remainingLabel(item.remainingKm)} · ${item.item.intervalKm.toLocaleString('ko-KR')}km 주기`
                    : `${item.value} · ${item.detail}`}
                </Text>
                <Pressable
                  style={styles.completeButton}
                  onPress={() => item.kind === 'maintenance' ? void handleCompleteMaintenance(item) : void handleAcknowledgeEcu(item)}
                  disabled={isSaving}>
                  <Text style={styles.completeButtonText}>{item.kind === 'maintenance' ? '교체완료' : '점검완료'}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {!isLoading && !errorMessage && vehicles.length > 0 ? (
        <SectionCard title="차량 설정" body="차량을 선택하면 현재 기준거리와 주기성 교환품목을 확인할 수 있습니다.">
          <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicle?.id ?? null} onSelect={setSelectedVehicleId} />
          {selectedVehicle && selectedState ? (
            <>
              <StatusLine label="차량번호" value={selectedVehicle.vehicleNumber} />
              <StatusLine label="현재 기준" value={selectedState.currentKm === null ? '-' : formatKm(selectedState.currentKm)} />
              <StatusLine label="ECU 상태" value={selectedObd ? `최근 수신 · ${selectedObd.recordedAt.slice(5, 16).replace('T', ' ')}` : '미수신'} />

              <Text style={styles.settingsTitle}>주기성 교환품목</Text>
              <View style={styles.grid}>
                {maintenanceCards.map((card, index) => (
                  <View key={card.item.key} style={[styles.maintenanceCard, { backgroundColor: PART_COLORS[index % PART_COLORS.length] }, card.tone === 'bad' && styles.badCard, card.tone === 'warn' && styles.warnCard]}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                    <Text style={styles.cardValue} numberOfLines={2} adjustsFontSizeToFit>{card.value}</Text>
                    <Text style={styles.cardDetail} numberOfLines={1}>{card.detail}</Text>
                    <Pressable
                      style={styles.cardAction}
                      onPress={() => void handleCompleteMaintenance({
                        kind: 'maintenance',
                        id: `${selectedVehicle.id}:${card.item.key}`,
                        severity: card.tone === 'bad' ? 'bad' : 'warn',
                        vehicle: selectedVehicle,
                        item: card.item,
                        remainingKm: getRemainingKm(selectedState, card.item) ?? 0,
                      })}
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
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
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
  settingsTitle: { color: '#13866F', fontSize: 21, fontWeight: '900', marginTop: 20, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  maintenanceCard: {
    width: '48%',
    minHeight: 148,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    padding: 14,
    justifyContent: 'space-between',
  },
  cardTitle: { color: '#52607D', fontSize: 14, fontWeight: '900' },
  cardValue: { color: '#222B45', fontSize: 22, fontWeight: '900', lineHeight: 26 },
  cardDetail: { color: '#7180A3', fontSize: 12, fontWeight: '800' },
  cardAction: {
    minHeight: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionText: { color: '#5B7CFA', fontSize: 14, fontWeight: '900' },
});
