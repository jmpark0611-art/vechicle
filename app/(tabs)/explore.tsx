import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { useRoleGuard } from '@/hooks/use-role-guard';
import { fetchTripGpsDistances } from '@/lib/gps-data';
import { fetchFuelEvents, fetchTripFuelUsage, loadSyncedObdSnapshot, type FuelEvent, type ObdSnapshot, type TripFuelUsage } from '@/lib/obd-data';
import { deleteTripsByIds, fetchTripsReadOnly, fetchVehiclesReadOnly, type TripDateRange, type TripSummary, type VehicleSummary } from '@/lib/readonly-data';

function formatTripTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function formatTripDate(value: string | null) {
  if (!value) return '날짜 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function statusLabel(status: string) {
  if (status === 'in_progress') return '운행 중';
  if (status === 'completed') return '완료';
  if (status === 'canceled' || status === 'cancelled') return '취소';
  return status;
}

function tripDistance(trip: TripSummary) {
  if (trip.dailyKm !== null && trip.dailyKm >= 0) {
    return `${Math.round(trip.dailyKm).toLocaleString('ko-KR')}km`;
  }
  if (trip.startOdometer !== null && trip.endOdometer !== null && trip.endOdometer >= trip.startOdometer) {
    return `${Math.round(trip.endOdometer - trip.startOdometer).toLocaleString('ko-KR')}km`;
  }
  return '-';
}

function totalOdometer(trip: TripSummary) {
  const value = trip.endOdometer ?? trip.startOdometer;
  return value === null ? '-' : `${Math.round(value).toLocaleString('ko-KR')}km`;
}

function gpsDistanceLabel(gpsDistances: Record<string, number>, tripId: string) {
  const value = gpsDistances[tripId];
  return typeof value === 'number' && value > 0 ? `${value.toLocaleString('ko-KR')}km` : '-';
}

function fuelUsageLabel(fuelUsage: TripFuelUsage, tripId: string) {
  const value = fuelUsage[tripId];
  return typeof value === 'number' && value > 0 ? `${Math.round(value * 10) / 10}%` : '-';
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  };
}

function monthRangeFor(year: number, month: number): TripDateRange {
  return {
    from: new Date(year, month, 1).toISOString(),
    to: new Date(year, month + 1, 1).toISOString(),
  };
}

function monthLabel(year: number, month: number) {
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const isLastMonth = year === (month === 0 ? now.getFullYear() - 1 : now.getFullYear()) && month === (now.getMonth() === 0 ? 11 : now.getMonth() - 1);
  if (isCurrentMonth) return '이번달';
  if (isLastMonth) return '지난달';
  return `${year}.${month + 1}`;
}

function fuelEventText(events: FuelEvent[], vehicleId: string | null) {
  if (!vehicleId) return '';
  return events
    .filter((event) => event.vehicleId === vehicleId)
    .map((event) => `${formatTripTime(event.recordedAt)} ${event.beforePercent}%→${event.afterPercent}%`)
    .join(' / ');
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function dailyDocumentDate(value: string | null) {
  if (!value) return '날짜 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function groupTripsByDay(trips: TripSummary[]) {
  const grouped = new Map<string, TripSummary[]>();
  for (const trip of trips) {
    const key = dailyDocumentDate(trip.startTime);
    grouped.set(key, [...(grouped.get(key) ?? []), trip]);
  }
  return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default function RecordsScreen() {
  useRoleGuard(['commander', 'admin']);

  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [fuelEvents, setFuelEvents] = useState<FuelEvent[]>([]);
  const [tripFuelUsage, setTripFuelUsage] = useState<TripFuelUsage>({});
  const [gpsDistances, setGpsDistances] = useState<Record<string, number>>({});
  const [selectedTrip, setSelectedTrip] = useState<TripSummary | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportFrom, setExportFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState(() => new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState(() => new Date().getMonth());
  const [showAllMonths, setShowAllMonths] = useState(false);

  const activeDateRange = useMemo<TripDateRange | undefined>(
    () => (showAllMonths ? undefined : monthRangeFor(filterYear, filterMonth)),
    [filterYear, filterMonth, showAllMonths]
  );

  const loadData = useCallback(async (dateRange?: TripDateRange) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextTrips, nextVehicles] = await Promise.all([fetchTripsReadOnly(200, dateRange), fetchVehiclesReadOnly(200)]);
      const vehicleIds = nextVehicles.map((vehicle) => vehicle.id);
      const [obd, nextGpsDistances, nextTripFuelUsage] = await Promise.all([
        loadSyncedObdSnapshot(vehicleIds),
        fetchTripGpsDistances(nextTrips.map((trip) => trip.id)),
        fetchTripFuelUsage(nextTrips.map((trip) => trip.id)),
      ]);
      const range = currentMonthRange();
      const nextFuelEvents = await fetchFuelEvents(vehicleIds, range.from, range.to);
      setTrips(nextTrips);
      setVehicles(nextVehicles);
      setObdSnapshot(obd.snapshot);
      setGpsDistances(nextGpsDistances);
      setTripFuelUsage(nextTripFuelUsage);
      setFuelEvents(nextFuelEvents);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '운행 기록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(activeDateRange);
  }, [loadData, activeDateRange]);

  useFocusEffect(
    useCallback(() => {
      void loadData(activeDateRange);
    }, [loadData, activeDateRange])
  );

  function shiftMonth(delta: number) {
    setShowAllMonths(false);
    setFilterMonth((m) => {
      const next = m + delta;
      if (next < 0) { setFilterYear((y) => y - 1); return 11; }
      if (next > 11) { setFilterYear((y) => y + 1); return 0; }
      return next;
    });
  }

  const filtered = useMemo(
    () => (selectedVehicleId ? trips.filter((trip) => trip.vehicleId === selectedVehicleId) : trips),
    [selectedVehicleId, trips]
  );
  const completedCount = useMemo(() => filtered.filter((trip) => trip.status === 'completed').length, [filtered]);
  const totalOdometerKm = useMemo(
    () => filtered.reduce((sum, trip) => {
      const km = trip.dailyKm ?? (
        trip.startOdometer !== null && trip.endOdometer !== null && trip.endOdometer >= trip.startOdometer
          ? trip.endOdometer - trip.startOdometer : 0
      );
      return sum + Math.max(0, km ?? 0);
    }, 0),
    [filtered]
  );

  function parseDateStart(value: string) {
    const date = new Date(`${value.trim()}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseDateEnd(value: string) {
    const date = new Date(`${value.trim()}T23:59:59`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async function exportMonthlyLog() {
    const fromDate = parseDateStart(exportFrom);
    const toDate = parseDateEnd(exportTo);
    if (!fromDate || !toDate || fromDate > toDate) {
      Alert.alert('기간 확인', '기간을 YYYY-MM-DD 형식으로 올바르게 입력해 주세요.');
      return;
    }

    const exportRows = filtered.filter((trip) => {
      if (!trip.startTime) return false;
      const started = new Date(trip.startTime);
      return !Number.isNaN(started.getTime()) && started >= fromDate && started <= toDate;
    });

    if (exportRows.length === 0) {
      Alert.alert('내보낼 기록 없음', '선택한 조건의 운행 기록이 없습니다.');
      return;
    }

    const rows = [
      '\uFEFF월장비운행증 일일 작성 문서',
      `기간,${exportFrom},${exportTo}`,
      '',
    ];

    for (const [day, dayTrips] of groupTripsByDay(exportRows)) {
      rows.push(`작성일자,${day}`);
      rows.push('차량번호,상태,출발시각,도착시각,출발지,목적지,운행목적,운행자,사용자,계기판 총 주행거리,계기판 운행거리,GPS 참고거리,소모한 유류,OBD 연료,주유추정');

      for (const trip of dayTrips) {
        const fuel = trip.vehicleId && obdSnapshot[trip.vehicleId]?.fuelPercent !== null && obdSnapshot[trip.vehicleId]?.fuelPercent !== undefined
          ? `${obdSnapshot[trip.vehicleId].fuelPercent}%`
          : '';
        const operator = [trip.operatorRank, trip.operatorName].filter(Boolean).join(' ');
        const user = [trip.userRank, trip.userName].filter(Boolean).join(' ');
        rows.push([
          trip.vehicleNumber,
          statusLabel(trip.status),
          formatTripTime(trip.startTime),
          formatTripTime(trip.endTime),
          trip.startPlace ?? '',
          trip.endPlace ?? '',
          trip.purpose ?? '',
          operator,
          user,
          totalOdometer(trip),
          tripDistance(trip),
          gpsDistanceLabel(gpsDistances, trip.id),
          fuelUsageLabel(tripFuelUsage, trip.id),
          fuel,
          fuelEventText(fuelEvents, trip.vehicleId),
        ].map(csvCell).join(','));
      }

      const dayOdometerKm = dayTrips.reduce((sum, trip) => {
        const value = trip.dailyKm ?? (
          trip.startOdometer !== null && trip.endOdometer !== null && trip.endOdometer >= trip.startOdometer
            ? trip.endOdometer - trip.startOdometer
            : 0
        );
        return sum + Math.max(0, value ?? 0);
      }, 0);
      const dayGpsKm = dayTrips.reduce((sum, trip) => sum + (gpsDistances[trip.id] ?? 0), 0);
      rows.push(`일일합계,운행 ${dayTrips.length}건,계기판 운행거리 ${Math.round(dayOdometerKm).toLocaleString('ko-KR')}km,GPS 참고거리 ${Math.round(dayGpsKm * 10) / 10}km`);
      rows.push('');
    }

    await Share.share({
      title: '월장비운행증 엑셀 내보내기',
      message: rows.join('\n'),
    });
    setExportModalVisible(false);
  }

  function confirmDeleteVisibleTrips() {
    if (filtered.length === 0 || isDeleting) return;
    Alert.alert(
      '운행 기록 삭제',
      selectedVehicleId
        ? '선택한 차량의 화면에 표시된 운행 기록을 삭제합니다. 삭제 후에는 앱에서 복구할 수 없습니다.'
        : '화면에 표시된 전체 운행 기록을 삭제합니다. 삭제 후에는 앱에서 복구할 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void deleteVisibleTrips();
          },
        },
      ]
    );
  }

  async function deleteVisibleTrips() {
    setIsDeleting(true);
    try {
      await deleteTripsByIds(filtered.map((trip) => trip.id));
      setSelectedTrip(null);
      await loadData();
      Alert.alert('삭제 완료', '화면에 표시된 운행 기록을 삭제했습니다.');
    } catch (error) {
      Alert.alert('삭제 실패', error instanceof Error ? error.message : '운행 기록을 삭제하지 못했습니다.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <RebuildScreen
      title="기록"
      metrics={[
        { label: '완료', value: `${completedCount}건` },
        { label: '계기판 합계', value: `${Math.round(totalOdometerKm).toLocaleString('ko-KR')}km` },
      ]}
      bottomSpace="tab">

      {/* 월 필터 */}
      <View style={styles.monthFilterRow}>
        <Pressable style={styles.monthArrow} onPress={() => shiftMonth(-1)}>
          <Text style={styles.monthArrowText}>◀</Text>
        </Pressable>
        <Pressable
          style={[styles.monthChip, !showAllMonths && styles.monthChipActive]}
          onPress={() => setShowAllMonths(false)}>
          <Text style={[styles.monthChipText, !showAllMonths && styles.monthChipTextActive]}>
            {monthLabel(filterYear, filterMonth)}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.monthChip, showAllMonths && styles.monthChipActive]}
          onPress={() => setShowAllMonths(true)}>
          <Text style={[styles.monthChipText, showAllMonths && styles.monthChipTextActive]}>전체</Text>
        </Pressable>
        <Pressable style={styles.monthArrow} onPress={() => shiftMonth(1)}>
          <Text style={styles.monthArrowText}>▶</Text>
        </Pressable>
        <Pressable style={styles.refreshBtn} onPress={() => void loadData(activeDateRange)} disabled={isLoading}>
          <Text style={styles.refreshBtnText}>{isLoading ? '…' : '↻'}</Text>
        </Pressable>
      </View>

      <Pressable style={styles.exportBtn} onPress={() => {
        if (!showAllMonths) {
          const from = new Date(filterYear, filterMonth, 1);
          const to = new Date(filterYear, filterMonth + 1, 0);
          setExportFrom(`${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`);
          setExportTo(`${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`);
        }
        setExportModalVisible(true);
      }}>
        <Text style={styles.exportBtnText}>월장비운행증 엑셀 내보내기</Text>
      </Pressable>

      {filtered.length > 0 ? (
        <Pressable style={[styles.deleteRecordsBtn, isDeleting && styles.disabledBtn]} onPress={confirmDeleteVisibleTrips} disabled={isDeleting}>
          <Text style={styles.deleteRecordsBtnText}>{isDeleting ? '삭제 중' : '운행 기록 삭제'}</Text>
        </Pressable>
      ) : null}

      {vehicles.length > 0 ? (
        <SectionCard title="차량 선택">
          <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicleId} onSelect={setSelectedVehicleId} includeAll allLabel="전체" />
        </SectionCard>
      ) : null}

      {isLoading ? (
        <LoadingCard label="운행 기록을 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : filtered.length === 0 ? (
        <SectionCard title="기록 없음" body="조건에 맞는 운행 기록이 없습니다." />
      ) : (
        filtered.map((trip) => (
          <Pressable key={trip.id} onPress={() => setSelectedTrip(trip)}>
            <SectionCard title={`${formatTripDate(trip.startTime)} · ${trip.vehicleNumber}`}>
              <Text style={styles.routeText} numberOfLines={1}>
                {trip.startPlace ?? '-'} → {trip.endPlace ?? '-'}
              </Text>
              <Text style={styles.compactMeta} numberOfLines={1}>
                계기판 {tripDistance(trip)} · GPS {gpsDistanceLabel(gpsDistances, trip.id)} · 유류 {fuelUsageLabel(tripFuelUsage, trip.id)}
              </Text>
            </SectionCard>
          </Pressable>
        ))
      )}

      <Modal visible={selectedTrip !== null} transparent animationType="fade" onRequestClose={() => setSelectedTrip(null)}>
        <View style={styles.modalDim}>
          <View style={styles.detailModal}>
            {selectedTrip ? (
              <>
                <Text style={styles.modalTitle}>{selectedTrip.vehicleNumber}</Text>
                <Text style={styles.modalSub}>{formatTripDate(selectedTrip.startTime)} · {statusLabel(selectedTrip.status)}</Text>
                <StatusLine label="경로" value={`${selectedTrip.startPlace ?? '-'} → ${selectedTrip.endPlace ?? '-'}`} />
                <StatusLine label="출발" value={formatTripTime(selectedTrip.startTime)} />
                <StatusLine label="도착" value={formatTripTime(selectedTrip.endTime)} />
                <StatusLine label="계기판 총 주행거리" value={totalOdometer(selectedTrip)} />
                <StatusLine label="계기판 운행거리" value={tripDistance(selectedTrip)} />
                <StatusLine label="GPS 참고거리" value={gpsDistanceLabel(gpsDistances, selectedTrip.id)} />
                <StatusLine label="소모한 유류" value={fuelUsageLabel(tripFuelUsage, selectedTrip.id)} />
                <StatusLine label="운행목적" value={selectedTrip.purpose ?? '-'} />
                <StatusLine label="운행자" value={[selectedTrip.operatorRank, selectedTrip.operatorName].filter(Boolean).join(' ') || '-'} />
                <StatusLine label="사용자" value={[selectedTrip.userRank, selectedTrip.userName].filter(Boolean).join(' ') || '-'} />
                <StatusLine label="OBD 연료" value={selectedTrip.vehicleId && obdSnapshot[selectedTrip.vehicleId]?.fuelPercent != null ? `${obdSnapshot[selectedTrip.vehicleId].fuelPercent}%` : '-'} />
                <StatusLine label="주유추정" value={fuelEventText(fuelEvents, selectedTrip.vehicleId) || '-'} />
                <Pressable style={styles.modalClose} onPress={() => setSelectedTrip(null)}>
                  <Text style={styles.modalCloseText}>닫기</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={exportModalVisible} transparent animationType="fade" onRequestClose={() => setExportModalVisible(false)}>
        <View style={styles.modalDim}>
          <View style={styles.detailModal}>
            <Text style={styles.modalTitle}>엑셀 내보내기</Text>
            <Text style={styles.modalSub}>기간을 설정하면 해당 기간의 월장비운행증 데이터를 CSV로 공유합니다.</Text>
            <TextInput
              style={styles.dateInput}
              value={exportFrom}
              onChangeText={setExportFrom}
              placeholder="시작일 YYYY-MM-DD"
              placeholderTextColor="#9AA8C7"
            />
            <TextInput
              style={styles.dateInput}
              value={exportTo}
              onChangeText={setExportTo}
              placeholder="종료일 YYYY-MM-DD"
              placeholderTextColor="#9AA8C7"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setExportModalVisible(false)}>
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={() => void exportMonthlyLog()}>
                <Text style={styles.modalSaveText}>엑셀 내보내기</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  monthFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 10,
  },
  monthArrow: {
    width: 32,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowText: { color: '#2563EB', fontSize: 14, fontWeight: '700' },
  monthChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  monthChipActive: { backgroundColor: '#2563EB' },
  monthChipText: { color: '#475569', fontSize: 13, fontWeight: '600' },
  monthChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  refreshBtn: {
    minHeight: 36,
    width: 36,
    borderRadius: 10,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: { color: '#2563EB', fontSize: 16, fontWeight: '700' },
  exportBtn: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  exportBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  deleteRecordsBtn: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#FFF1F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFE4E6',
  },
  deleteRecordsBtnText: { color: '#E11D48', fontSize: 14, fontWeight: '700' },
  disabledBtn: { opacity: 0.55 },
  routeText: { color: '#64748B', fontSize: 14, fontWeight: '500', marginTop: 10 },
  compactMeta: { color: '#94A3B8', fontSize: 12, fontWeight: '500', marginTop: 8 },
  modalDim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.32)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  detailModal: { width: '100%', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18 },
  modalTitle: { color: '#0F172A', fontSize: 20, fontWeight: '700' },
  modalSub: { color: '#64748B', fontSize: 13, fontWeight: '500', marginTop: 4, marginBottom: 8 },
  modalClose: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  modalCloseText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  dateInput: {
    minHeight: 48,
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
  modalSave: { flex: 1.35, minHeight: 46, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
