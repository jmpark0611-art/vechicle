import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { getStoredUnitCode, getStoredUnitName } from '../../lib/unit';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type Vehicle = { id: string; vehicle_number: string; equipment_name: string | null };

type TripRow = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  end_time: string | null;
  purpose: string | null;
  operator_name: string | null;
  operator_rank: string | null;
  user_name: string | null;
  user_rank: string | null;
  daily_km: number | null;
  start_odometer: number | null;
  end_odometer: number | null;
  status: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getKoreanMonths(): { year: number; month: number; label: string }[] {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    });
  }
  return months;
}

export default function MonthlyLogScreen() {
  const insets = useSafeAreaInsets();
  const months = getKoreanMonths();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(months[0]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [unitName, setUnitName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [monthModalVisible, setMonthModalVisible] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [unitCode, name] = await Promise.all([getStoredUnitCode(), getStoredUnitName()]);
      if (name) setUnitName(name);

      const vq = supabase.from('vehicles').select('id, vehicle_number, equipment_name').order('vehicle_number');
      if (unitCode) vq.eq('unit_code', unitCode);
      const { data: vData, error: vErr } = await withTimeout(vq, '차량 목록');
      if (vErr) { setError(formatDbError(vErr)); return; }
      setVehicles((vData ?? []) as Vehicle[]);
    } catch (e) {
      setError(formatDbError(e, '데이터 로드 실패'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadTrips = useCallback(async (vehicleId: string, year: number, month: number) => {
    setIsLoading(true);
    setError(null);
    setTrips([]);
    try {
      const startDate = new Date(year, month - 1, 1).toISOString();
      const endDate = new Date(year, month, 1).toISOString();

      const { data, error: tErr } = await withTimeout(
        supabase
          .from('trips')
          .select('id, vehicle_id, start_place, end_place, start_time, end_time, purpose, operator_name, operator_rank, user_name, user_rank, daily_km, start_odometer, end_odometer, status')
          .eq('vehicle_id', vehicleId)
          .gte('start_time', startDate)
          .lt('start_time', endDate)
          .order('start_time', { ascending: true }),
        '운행 기록'
      );
      if (tErr) { setError(formatDbError(tErr)); return; }
      setTrips((data ?? []) as TripRow[]);
    } catch (e) {
      setError(formatDbError(e, '운행 기록 로드 실패'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));

  const handleVehicleSelect = (v: Vehicle) => {
    setSelectedVehicle(v);
    setVehicleModalVisible(false);
    void loadTrips(v.id, selectedMonth.year, selectedMonth.month);
  };

  const handleMonthSelect = (m: typeof months[0]) => {
    setSelectedMonth(m);
    setMonthModalVisible(false);
    if (selectedVehicle) void loadTrips(selectedVehicle.id, m.year, m.month);
  };

  const totalKm = trips.reduce((sum, t) => sum + (t.daily_km ?? 0), 0);
  const completedTrips = trips.filter((t) => t.status === 'completed');

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + 84 }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>월 장비운행증</Text>
        {unitName ? <Text style={styles.headerUnit}>{unitName}</Text> : null}
      </View>

      {/* 필터 바 */}
      <View style={styles.filterRow}>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setVehicleModalVisible(true)}>
          <Text style={styles.filterLabel}>차량</Text>
          <Text style={styles.filterValue} numberOfLines={1}>
            {selectedVehicle ? selectedVehicle.vehicle_number : '선택'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setMonthModalVisible(true)}>
          <Text style={styles.filterLabel}>기간</Text>
          <Text style={styles.filterValue}>{selectedMonth.label}</Text>
        </TouchableOpacity>
      </View>

      {/* 요약 */}
      {selectedVehicle && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{completedTrips.length}</Text>
            <Text style={styles.summaryLabel}>완료 운행</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalKm.toFixed(0)}</Text>
            <Text style={styles.summaryLabel}>총 km</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{trips[0]?.start_odometer?.toFixed(0) ?? '-'}</Text>
            <Text style={styles.summaryLabel}>월초 계기</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{trips[trips.length - 1]?.end_odometer?.toFixed(0) ?? '-'}</Text>
            <Text style={styles.summaryLabel}>월말 계기</Text>
          </View>
        </View>
      )}

      {/* 본문 */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.loadingText}>로드 중...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !selectedVehicle ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>위에서 차량을 선택하세요</Text>
        </View>
      ) : trips.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{selectedMonth.label} 운행 기록이 없습니다</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false} horizontal={false}>
          {/* 테이블 헤더 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.cell, styles.cellDate, styles.headerCell]}>날짜</Text>
                <Text style={[styles.cell, styles.cellTime, styles.headerCell]}>출발</Text>
                <Text style={[styles.cell, styles.cellTime, styles.headerCell]}>도착</Text>
                <Text style={[styles.cell, styles.cellPlace, styles.headerCell]}>출발지</Text>
                <Text style={[styles.cell, styles.cellPlace, styles.headerCell]}>목적지</Text>
                <Text style={[styles.cell, styles.cellPurpose, styles.headerCell]}>목적</Text>
                <Text style={[styles.cell, styles.cellName, styles.headerCell]}>운용자</Text>
                <Text style={[styles.cell, styles.cellName, styles.headerCell]}>사용자</Text>
                <Text style={[styles.cell, styles.cellKm, styles.headerCell]}>거리</Text>
              </View>
              {trips.map((trip, idx) => (
                <View key={trip.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                  <Text style={[styles.cell, styles.cellDate]}>{formatDate(trip.start_time)}</Text>
                  <Text style={[styles.cell, styles.cellTime]}>{formatTime(trip.start_time)}</Text>
                  <Text style={[styles.cell, styles.cellTime]}>{formatTime(trip.end_time)}</Text>
                  <Text style={[styles.cell, styles.cellPlace]} numberOfLines={1}>{trip.start_place ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellPlace]} numberOfLines={1}>{trip.end_place ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellPurpose]} numberOfLines={1}>{trip.purpose ?? '-'}</Text>
                  <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>
                    {[trip.operator_rank, trip.operator_name].filter(Boolean).join(' ') || '-'}
                  </Text>
                  <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>
                    {[trip.user_rank, trip.user_name].filter(Boolean).join(' ') || '-'}
                  </Text>
                  <Text style={[styles.cell, styles.cellKm]}>
                    {trip.daily_km != null ? `${trip.daily_km}km` : '-'}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      )}

      {/* 차량 선택 모달 */}
      <Modal visible={vehicleModalVisible} transparent animationType="slide" onRequestClose={() => setVehicleModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setVehicleModalVisible(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>차량 선택</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {vehicles.map((v) => (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.modalItem, selectedVehicle?.id === v.id && styles.modalItemActive]}
                  onPress={() => handleVehicleSelect(v)}>
                  <Text style={[styles.modalItemText, selectedVehicle?.id === v.id && styles.modalItemTextActive]}>
                    {v.vehicle_number}{v.equipment_name ? ` (${v.equipment_name})` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 월 선택 모달 */}
      <Modal visible={monthModalVisible} transparent animationType="slide" onRequestClose={() => setMonthModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMonthModalVisible(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>기간 선택</Text>
            {months.map((m) => (
              <TouchableOpacity
                key={`${m.year}-${m.month}`}
                style={[styles.modalItem, selectedMonth.year === m.year && selectedMonth.month === m.month && styles.modalItemActive]}
                onPress={() => handleMonthSelect(m)}>
                <Text style={[styles.modalItemText, selectedMonth.year === m.year && selectedMonth.month === m.month && styles.modalItemTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: { color: '#0F172A', fontSize: 20, fontWeight: '800' },
  headerUnit: { color: '#2563EB', fontSize: 13, fontWeight: '600', marginTop: 2 },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  filterBtn: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
  },
  filterLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 2 },
  filterValue: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { color: '#1D4ED8', fontSize: 16, fontWeight: '800' },
  summaryLabel: { color: '#64748B', fontSize: 11, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: '#BFDBFE', marginVertical: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: '#64748B', marginTop: 8 },
  errorText: { color: '#DC2626', fontSize: 14, textAlign: 'center' },
  emptyText: { color: '#94A3B8', fontSize: 15, textAlign: 'center' },
  list: { flex: 1 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
  },
  tableRowAlt: { backgroundColor: '#F8FAFC' },
  tableHeader: { backgroundColor: '#F1F5F9', borderBottomWidth: 2, borderBottomColor: '#E2E8F0' },
  cell: { fontSize: 12, color: '#334155', paddingHorizontal: 4 },
  headerCell: { fontWeight: '700', color: '#0F172A', fontSize: 11 },
  cellDate: { width: 44 },
  cellTime: { width: 44 },
  cellPlace: { width: 80 },
  cellPurpose: { width: 72 },
  cellName: { width: 72 },
  cellKm: { width: 44, textAlign: 'right' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '60%' },
  modalTitle: { color: '#0F172A', fontSize: 17, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  modalItem: { paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', borderRadius: 8 },
  modalItemActive: { backgroundColor: '#EFF6FF' },
  modalItemText: { color: '#334155', fontSize: 15, fontWeight: '600' },
  modalItemTextActive: { color: '#2563EB' },
});
