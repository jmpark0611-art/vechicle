import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { useRoleGuard } from '@/hooks/use-role-guard';
import { fetchTripsReadOnly, fetchVehiclesReadOnly, type TripSummary, type VehicleSummary } from '@/lib/readonly-data';

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

function fmtTime(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function fmtKm(trip: TripSummary) {
  if (trip.dailyKm != null) return `${trip.dailyKm}km`;
  if (trip.startOdometer != null && trip.endOdometer != null) return `${Math.round(trip.endOdometer - trip.startOdometer)}km`;
  return '-';
}

function fmtPerson(rank: string | null, name: string | null) {
  if (!rank && !name) return '-';
  return [rank, name].filter(Boolean).join(' ');
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
  const [isLoading, setIsLoading] = useState(false);

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
      const data = await fetchTripsReadOnly(200, { from: monthStart(year, month), to: monthEnd(year, month) });
      setTrips(data.filter((t) => t.vehicleId === selectedVehicleId));
    } catch {
      setTrips([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedVehicleId, year, month]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const vs = await fetchVehiclesReadOnly(50);
        setVehicles(vs);
      })();
      void loadData();
    }, [loadData])
  );

  const totalKm = useMemo(() => {
    return trips.reduce((sum, t) => {
      if (t.dailyKm != null) return sum + t.dailyKm;
      if (t.startOdometer != null && t.endOdometer != null) return sum + (t.endOdometer - t.startOdometer);
      return sum;
    }, 0);
  }, [trips]);

  async function handleExport() {
    if (trips.length === 0) { Alert.alert('내보내기', '기록이 없습니다.'); return; }
    const vehicleNum = vehicles.find((v) => v.id === selectedVehicleId)?.vehicleNumber ?? '';
    const header = '일자,출발,도착,출발지,목적지,목적,운용자,사용자,거리';
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
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    await Share.share({
      title: `${vehicleNum} ${monthLabel} 월장비운행증`,
      message: [header, ...rows].join('\n'),
    });
  }

  return (
    <RebuildScreen
      title="월장비운행증"
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
              {/* Header row */}
              <View style={styles.headerRow}>
                {HEADERS.map((h) => (
                  <Text key={h.key} style={[styles.headerCell, { width: h.w }]}>{h.label}</Text>
                ))}
              </View>
              {/* Data rows */}
              {trips.map((t, idx) => (
                <View key={t.id} style={[styles.dataRow, idx % 2 === 1 && styles.dataRowAlt]}>
                  <Text style={[styles.cell, { width: COL.date }]}>{fmtDate(t.startTime)}</Text>
                  <Text style={[styles.cell, { width: COL.time }]}>{fmtTime(t.startTime)}</Text>
                  <Text style={[styles.cell, { width: COL.time }]}>{fmtTime(t.endTime)}</Text>
                  <Text style={[styles.cell, { width: COL.place }]} numberOfLines={1}>{t.startPlace ?? '-'}</Text>
                  <Text style={[styles.cell, { width: COL.place }]} numberOfLines={1}>{t.endPlace ?? '-'}</Text>
                  <Text style={[styles.cell, { width: COL.purpose }]} numberOfLines={1}>{t.purpose ?? '-'}</Text>
                  <Text style={[styles.cell, { width: COL.person }]} numberOfLines={1}>{fmtPerson(t.operatorRank, t.operatorName)}</Text>
                  <Text style={[styles.cell, { width: COL.person }]} numberOfLines={1}>{fmtPerson(t.userRank, t.userName)}</Text>
                  <Text style={[styles.cell, { width: COL.km }]}>{fmtKm(t)}</Text>
                </View>
              ))}
              {/* Total row */}
              <View style={styles.totalRow}>
                <Text style={[styles.totalCell, { width: COL.date + COL.time + COL.time + COL.place + COL.purpose + COL.place + COL.person + COL.person + 56 }]}>
                  합계 {trips.length}건
                </Text>
                <Text style={[styles.totalCell, { width: COL.km }]}>
                  {totalKm > 0 ? `${Math.round(totalKm)}km` : '-'}
                </Text>
              </View>
            </View>
          </ScrollView>
          <Pressable style={styles.exportBtn} onPress={() => void handleExport()}>
            <Text style={styles.exportBtnText}>CSV 내보내기</Text>
          </Pressable>
        </SectionCard>
      )}
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
  exportBtn: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  exportBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
