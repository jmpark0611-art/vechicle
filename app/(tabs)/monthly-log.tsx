import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { useRoleGuard } from '@/hooks/use-role-guard';
import { fetchTripGpsDistances } from '@/lib/gps-data';
import { fetchTripFuelUsage, type TripFuelUsage } from '@/lib/obd-data';
import { deleteTripsByIds, fetchTripsReadOnly, fetchVehiclesReadOnly, type TripSummary, type VehicleSummary } from '@/lib/readonly-data';

function monthStart(year: number, month: number) {
  return new Date(year, month, 1).toISOString();
}

function monthEnd(year: number, month: number) {
  return new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();
}

function fmtDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateFull(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function fmtTime(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function fmtKm(trip: TripSummary) {
  if (trip.dailyKm != null) return `${Math.round(trip.dailyKm)}km`;
  if (trip.startOdometer != null && trip.endOdometer != null) return `${Math.round(trip.endOdometer - trip.startOdometer)}km`;
  return '-';
}

function tripKmNum(trip: TripSummary): number {
  if (trip.dailyKm != null) return trip.dailyKm;
  if (trip.startOdometer != null && trip.endOdometer != null) return Math.max(0, trip.endOdometer - trip.startOdometer);
  return 0;
}

function fmtPerson(rank: string | null, name: string | null) {
  if (!rank && !name) return '-';
  return [rank, name].filter(Boolean).join(' ');
}

function fmtGps(gpsDistances: Record<string, number>, tripId: string) {
  const v = gpsDistances[tripId];
  return typeof v === 'number' && v > 0 ? `${v.toLocaleString('ko-KR')}km` : '-';
}

function fmtFuel(tripFuelUsage: TripFuelUsage, tripId: string) {
  const v = tripFuelUsage[tripId];
  return typeof v === 'number' && v > 0 ? `${Math.round(v * 10) / 10}%` : '-';
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

const COL = {
  date: 52,
  time: 48,
  place: 72,
  purpose: 76,
  person: 84,
  km: 48,
};

const HEADERS = [
  { key: 'date', label: '일자', w: COL.date },
  { key: 'start', label: '출발', w: COL.time },
  { key: 'end', label: '도착', w: COL.time },
  { key: 'from', label: '출발지', w: COL.place },
  { key: 'to', label: '목적지', w: COL.place },
  { key: 'purpose', label: '목적', w: COL.purpose },
  { key: 'operator', label: '운용자', w: COL.person },
  { key: 'user', label: '사용자', w: COL.person },
  { key: 'km', label: '거리', w: COL.km },
];

const TOTAL_WIDTH = HEADERS.reduce((s, h) => s + h.w, 0) + HEADERS.length * 10;

export default function MonthlyLogScreen() {
  useRoleGuard(['commander', 'admin']);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [gpsDistances, setGpsDistances] = useState<Record<string, number>>({});
  const [tripFuelUsage, setTripFuelUsage] = useState<TripFuelUsage>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<TripSummary | null>(null);

  const monthLabel = useMemo(() => `${year}년 ${month + 1}월`, [year, month]);

  function shiftMonth(delta: number) {
    setMonth((m) => {
      const next = m + delta;
      if (next < 0) { setYear((y) => y - 1); return 11; }
      if (next > 11) { setYear((y) => y + 1); return 0; }
      return next;
    });
  }

  const loadData = useCallback(async () => {
    if (!selectedVehicleId) return;
    setIsLoading(true);
    try {
      const allTrips = await fetchTripsReadOnly(200, { from: monthStart(year, month), to: monthEnd(year, month) });
      const filtered = allTrips.filter((t) => t.vehicleId === selectedVehicleId);
      const tripIds = filtered.map((t) => t.id);
      const [gps, fuel] = await Promise.all([
        fetchTripGpsDistances(tripIds),
        fetchTripFuelUsage(tripIds),
      ]);
      setTrips(filtered);
      setGpsDistances(gps);
      setTripFuelUsage(fuel);
    } catch {
      setTrips([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedVehicleId, year, month]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const vs = await fetchVehiclesReadOnly(50);
          setVehicles(vs);
        } catch {
          // vehicles list unavailable; dropdown stays empty
        }
      })();
      void loadData();
    }, [loadData])
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalKm = useMemo(() => trips.reduce((sum, t) => sum + tripKmNum(t), 0), [trips]);

  async function handleExport() {
    if (trips.length === 0) { Alert.alert('내보내기', '기록이 없습니다.'); return; }
    const vehicleNum = vehicles.find((v) => v.id === selectedVehicleId)?.vehicleNumber ?? '';
    const header = '일자,출발,도착,출발지,목적지,목적,운용자,사용자,거리,GPS거리,유류소모';
    const rows = trips.map((t) =>
      [
        fmtDate(t.startTime),
        fmtTime(t.startTime),
        fmtTime(t.endTime),
        t.startPlace ?? '',
        t.endPlace ?? '',
        t.purpose ?? '',
        fmtPerson(t.operatorRank, t.operatorName),
        fmtPerson(t.userRank, t.userName),
        fmtKm(t),
        fmtGps(gpsDistances, t.id),
        fmtFuel(tripFuelUsage, t.id),
      ]
        .map(csvCell)
        .join(',')
    );
    await Share.share({
      title: `${vehicleNum} ${monthLabel} 월장비운행증`,
      message: [header, ...rows].join('\n'),
    });
  }

  function confirmDelete() {
    if (trips.length === 0 || isDeleting) return;
    const vehicleNum = vehicles.find((v) => v.id === selectedVehicleId)?.vehicleNumber ?? '';
    Alert.alert(
      '운행 기록 삭제',
      `${monthLabel} ${vehicleNum} 운행 기록 ${trips.length}건을 삭제합니다. 복구할 수 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => { void handleDelete(); } },
      ]
    );
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await deleteTripsByIds(trips.map((t) => t.id));
      setTrips([]);
      Alert.alert('삭제 완료', '운행 기록을 삭제했습니다.');
    } catch (error) {
      Alert.alert('삭제 실패', error instanceof Error ? error.message : '삭제하지 못했습니다.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <RebuildScreen
      title="운행증"
      metrics={[
        { label: monthLabel, value: `${trips.length}건` },
        { label: '합계거리', value: totalKm > 0 ? `${Math.round(totalKm)}km` : '-' },
      ]}
      actionLabel="새로고침"
      onAction={() => void loadData()}>

      <SectionCard title="차량·기간 선택">
        <VehicleDropdown
          vehicles={vehicles}
          selectedVehicleId={selectedVehicleId}
          onSelect={(id) => { setSelectedVehicleId(id); }}
        />
        <View style={styles.monthRow}>
          <Pressable style={styles.monthArrow} onPress={() => shiftMonth(-1)}>
            <Text style={styles.monthArrowText}>◀</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Pressable style={styles.monthArrow} onPress={() => shiftMonth(1)}>
            <Text style={styles.monthArrowText}>▶</Text>
          </Pressable>
        </View>
      </SectionCard>

      {!selectedVehicleId ? (
        <SectionCard title="안내" body="차량을 선택하면 해당 월 운행 기록이 표시됩니다." />
      ) : isLoading ? (
        <LoadingCard label="기록 불러오는 중" />
      ) : trips.length === 0 ? (
        <SectionCard title="기록 없음" body={`${monthLabel} 운행 기록이 없습니다.`} />
      ) : (
        <SectionCard title={`운행 기록 (${trips.length}건)`}>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
            <View style={{ minWidth: TOTAL_WIDTH }}>
              <View style={styles.headerRow}>
                {HEADERS.map((h) => (
                  <Text key={h.key} style={[styles.headerCell, { width: h.w }]}>{h.label}</Text>
                ))}
              </View>
              {trips.map((t, idx) => (
                <Pressable
                  key={t.id}
                  style={({ pressed }) => [styles.dataRow, idx % 2 === 1 && styles.dataRowAlt, pressed && styles.dataRowPressed]}
                  onPress={() => setSelectedTrip(t)}>
                  <Text style={[styles.cell, { width: COL.date }]}>{fmtDate(t.startTime)}</Text>
                  <Text style={[styles.cell, { width: COL.time }]}>{fmtTime(t.startTime)}</Text>
                  <Text style={[styles.cell, { width: COL.time }]}>{fmtTime(t.endTime)}</Text>
                  <Text style={[styles.cell, { width: COL.place }]} numberOfLines={1}>{t.startPlace ?? '-'}</Text>
                  <Text style={[styles.cell, { width: COL.place }]} numberOfLines={1}>{t.endPlace ?? '-'}</Text>
                  <Text style={[styles.cell, { width: COL.purpose }]} numberOfLines={1}>{t.purpose ?? '-'}</Text>
                  <Text style={[styles.cell, { width: COL.person }]} numberOfLines={1}>{fmtPerson(t.operatorRank, t.operatorName)}</Text>
                  <Text style={[styles.cell, { width: COL.person }]} numberOfLines={1}>{fmtPerson(t.userRank, t.userName)}</Text>
                  <Text style={[styles.cell, { width: COL.km }]}>{fmtKm(t)}</Text>
                </Pressable>
              ))}
              <View style={styles.totalRow}>
                <Text style={[styles.totalCell, { width: COL.date + COL.time + COL.time + COL.place + COL.purpose + COL.place + COL.person + COL.person + 70 }]}>
                  합계 {trips.length}건
                </Text>
                <Text style={[styles.totalCell, { width: COL.km }]}>
                  {totalKm > 0 ? `${Math.round(totalKm)}km` : '-'}
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.actionRow}>
            <Pressable style={styles.exportBtn} onPress={() => void handleExport()}>
              <Text style={styles.exportBtnText}>CSV 내보내기</Text>
            </Pressable>
            <Pressable style={[styles.deleteBtn, isDeleting && styles.disabledBtn]} onPress={confirmDelete} disabled={isDeleting}>
              <Text style={styles.deleteBtnText}>{isDeleting ? '삭제 중' : '삭제'}</Text>
            </Pressable>
          </View>
        </SectionCard>
      )}

      <Modal visible={selectedTrip !== null} transparent animationType="fade" onRequestClose={() => setSelectedTrip(null)}>
        <View style={styles.modalDim}>
          <View style={styles.detailModal}>
            {selectedTrip ? (
              <>
                <Text style={styles.modalTitle}>{selectedTrip.vehicleNumber}</Text>
                <Text style={styles.modalSub}>{fmtDateFull(selectedTrip.startTime)}</Text>
                <StatusLine label="경로" value={`${selectedTrip.startPlace ?? '-'} → ${selectedTrip.endPlace ?? '-'}`} />
                <StatusLine label="출발" value={fmtDateTime(selectedTrip.startTime)} />
                <StatusLine label="도착" value={fmtDateTime(selectedTrip.endTime)} />
                <StatusLine label="계기판 거리" value={fmtKm(selectedTrip)} />
                <StatusLine label="GPS 참고거리" value={fmtGps(gpsDistances, selectedTrip.id)} />
                <StatusLine label="유류 소모" value={fmtFuel(tripFuelUsage, selectedTrip.id)} />
                <StatusLine label="목적" value={selectedTrip.purpose ?? '-'} />
                <StatusLine label="운용자" value={fmtPerson(selectedTrip.operatorRank, selectedTrip.operatorName)} />
                <StatusLine label="사용자" value={fmtPerson(selectedTrip.userRank, selectedTrip.userName)} />
                <Pressable style={styles.modalClose} onPress={() => setSelectedTrip(null)}>
                  <Text style={styles.modalCloseText}>닫기</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowText: { color: '#2563EB', fontSize: 14, fontWeight: '800' },
  monthLabel: { color: '#0F172A', fontSize: 16, fontWeight: '800', minWidth: 100, textAlign: 'center' },
  tableScroll: { marginTop: 4 },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#1D4ED8',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    marginBottom: 2,
    gap: 10,
  },
  headerCell: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  dataRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 4,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dataRowAlt: { backgroundColor: '#F8FAFC' },
  dataRowPressed: { backgroundColor: '#EFF6FF' },
  cell: {
    fontSize: 11,
    color: '#1E293B',
    fontWeight: '600',
    textAlign: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    marginTop: 4,
    gap: 10,
  },
  totalCell: {
    fontSize: 11,
    color: '#1D4ED8',
    fontWeight: '800',
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  exportBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  deleteBtn: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FFE4E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { color: '#E11D48', fontSize: 14, fontWeight: '800' },
  disabledBtn: { opacity: 0.5 },
  modalDim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  detailModal: { width: '100%', borderRadius: 18, backgroundColor: '#FFFFFF', padding: 20 },
  modalTitle: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  modalSub: { color: '#64748B', fontSize: 13, fontWeight: '600', marginTop: 2, marginBottom: 10 },
  modalClose: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  modalCloseText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
