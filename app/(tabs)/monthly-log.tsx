import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchMonthlyTrips, fetchVehiclesReadOnly, type MonthlyTripRow, type VehicleSummary } from '@/lib/readonly-data';

function fmt(iso: string | null, part: 'date' | 'time'): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  if (part === 'date') {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function MonthlyLogScreen() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleSummary | null>(null);
  const [trips, setTrips] = useState<MonthlyTripRow[]>([]);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [vehiclePickerVisible, setVehiclePickerVisible] = useState(false);

  useEffect(() => {
    setIsLoadingVehicles(true);
    fetchVehiclesReadOnly(100)
      .then(setVehicles)
      .catch((e: unknown) => setErrorMessage(e instanceof Error ? e.message : '차량 목록 오류'))
      .finally(() => setIsLoadingVehicles(false));
  }, []);

  const loadTrips = useCallback(async (vehicleId: string, y: number, m: number) => {
    setIsLoadingTrips(true);
    setErrorMessage(null);
    try {
      setTrips(await fetchMonthlyTrips(vehicleId, y, m));
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : '운행 기록 오류');
      setTrips([]);
    } finally {
      setIsLoadingTrips(false);
    }
  }, []);

  useEffect(() => {
    if (selectedVehicle) {
      void loadTrips(selectedVehicle.id, year, month);
    }
  }, [selectedVehicle, year, month, loadTrips]);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonth(m);
    setYear(y);
  }

  const totalKm = trips.reduce((sum, t) => sum + (t.dailyKm ?? 0), 0);

  return (
    <RebuildScreen
      title="월 장비운행증"
      metrics={[
        { label: '운행 건수', value: `${trips.length}건` },
        { label: '총 거리', value: totalKm > 0 ? `${Math.round(totalKm)}km` : '-' },
      ]}
      actionLabel="새로고침"
      onAction={() => {
        if (selectedVehicle) void loadTrips(selectedVehicle.id, year, month);
      }}>

      <SectionCard title="조회 조건">
        <View style={styles.pickerRow}>
          <Pressable style={styles.pickerBtn} onPress={() => setVehiclePickerVisible(true)}>
            <Text style={styles.pickerBtnLabel}>차량</Text>
            <Text style={styles.pickerBtnValue} numberOfLines={1}>
              {selectedVehicle?.vehicleNumber ?? '선택하세요'}
            </Text>
          </Pressable>

          <View style={styles.monthPicker}>
            <Pressable style={styles.monthArrow} onPress={() => shiftMonth(-1)}>
              <Text style={styles.monthArrowText}>{'<'}</Text>
            </Pressable>
            <Text style={styles.monthLabel}>{year}년 {month}월</Text>
            <Pressable style={styles.monthArrow} onPress={() => shiftMonth(1)}>
              <Text style={styles.monthArrowText}>{'>'}</Text>
            </Pressable>
          </View>
        </View>
      </SectionCard>

      {!selectedVehicle ? (
        <SectionCard title="안내" body="차량을 선택하면 해당 월의 운행 내역이 표시됩니다." />
      ) : isLoadingTrips ? (
        <LoadingCard label="운행 기록을 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : trips.length === 0 ? (
        <SectionCard title={`${year}년 ${month}월 운행 기록`} body="해당 월에 운행 기록이 없습니다." />
      ) : (
        <SectionCard
          title={`${year}년 ${month}월 운행증 — ${selectedVehicle.vehicleNumber}`}
          body={`${trips.length}건 · 총 ${totalKm > 0 ? `${Math.round(totalKm)}km` : '거리 정보 없음'}`}>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
            <View>
              <View style={[styles.tableRow, styles.tableHeader]}>
                {['날짜', '출발', '도착', '출발지', '목적지', '목적', '운용자', '사용자', '거리'].map((h) => (
                  <Text key={h} style={[styles.cell, styles.headerCell, h === '날짜' || h === '출발' || h === '도착' ? styles.cellNarrow : styles.cellWide]}>
                    {h}
                  </Text>
                ))}
              </View>
              {trips.map((trip, idx) => (
                <View key={trip.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                  <Text style={[styles.cell, styles.cellNarrow]}>{fmt(trip.startTime, 'date')}</Text>
                  <Text style={[styles.cell, styles.cellNarrow]}>{fmt(trip.startTime, 'time')}</Text>
                  <Text style={[styles.cell, styles.cellNarrow]}>{fmt(trip.endTime, 'time')}</Text>
                  <Text style={[styles.cell, styles.cellWide]} numberOfLines={1}>{trip.startPlace ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellWide]} numberOfLines={1}>{trip.endPlace ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellWide]} numberOfLines={1}>{trip.purpose ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellWide]} numberOfLines={1}>{trip.operatorName ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellWide]} numberOfLines={1}>{trip.userName ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellNarrow]}>{trip.dailyKm !== null ? `${Math.round(trip.dailyKm)}` : '-'}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.summaryRow}>
            <StatusLine label="총 운행" value={`${trips.length}건`} />
            {totalKm > 0 && <StatusLine label="총 거리" value={`${Math.round(totalKm)}km`} />}
          </View>
        </SectionCard>
      )}

      <Modal visible={vehiclePickerVisible} transparent animationType="fade" onRequestClose={() => setVehiclePickerVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setVehiclePickerVisible(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>차량 선택</Text>
            {isLoadingVehicles ? (
              <Text style={styles.modalHint}>불러오는 중...</Text>
            ) : vehicles.length === 0 ? (
              <Text style={styles.modalHint}>등록된 차량이 없습니다.</Text>
            ) : (
              <ScrollView>
                {vehicles.map((v) => (
                  <Pressable
                    key={v.id}
                    style={[styles.modalItem, selectedVehicle?.id === v.id && styles.modalItemSelected]}
                    onPress={() => { setSelectedVehicle(v); setVehiclePickerVisible(false); }}>
                    <Text style={[styles.modalItemText, selectedVehicle?.id === v.id && styles.modalItemTextSelected]}>
                      {v.vehicleNumber}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  pickerRow: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'stretch' },
  pickerBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerBtnLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  pickerBtnValue: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  monthPicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthArrow: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F1F5F9' },
  monthArrowText: { color: '#2563EB', fontSize: 18, fontWeight: '900' },
  monthLabel: { color: '#0F172A', fontSize: 13, fontWeight: '800', minWidth: 80, textAlign: 'center' },
  tableScroll: { marginTop: 14 },
  tableRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  tableHeader: { borderTopWidth: 0, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  tableRowAlt: { backgroundColor: '#F8FAFC' },
  cell: { paddingVertical: 8, paddingHorizontal: 6, fontSize: 12, color: '#0F172A', fontWeight: '700' },
  headerCell: { color: '#64748B', fontWeight: '900', fontSize: 11 },
  cellNarrow: { width: 52 },
  cellWide: { width: 88 },
  summaryRow: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '60%',
  },
  modalTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900', marginBottom: 16 },
  modalHint: { color: '#94A3B8', fontSize: 14, fontWeight: '700' },
  modalItem: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  modalItemSelected: { backgroundColor: '#EFF6FF' },
  modalItemText: { color: '#0F172A', fontSize: 15, fontWeight: '700' },
  modalItemTextSelected: { color: '#2563EB', fontWeight: '900' },
});
