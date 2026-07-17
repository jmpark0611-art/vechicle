import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { fetchTripGpsDistances } from '@/lib/gps-data';
import { fetchFuelEvents, fetchTripFuelUsage, loadSyncedObdSnapshot, type FuelEvent, type ObdSnapshot, type TripFuelUsage } from '@/lib/obd-data';
import { fetchTripsReadOnly, fetchVehiclesReadOnly, type TripSummary, type VehicleSummary } from '@/lib/readonly-data';

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

function fuelEventText(events: FuelEvent[], vehicleId: string | null) {
  if (!vehicleId) return '';
  return events
    .filter((event) => event.vehicleId === vehicleId)
    .map((event) => `${formatTripTime(event.recordedAt)} ${event.beforePercent}%→${event.afterPercent}%`)
    .join(' / ');
}

export default function RecordsScreen() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [fuelEvents, setFuelEvents] = useState<FuelEvent[]>([]);
  const [tripFuelUsage, setTripFuelUsage] = useState<TripFuelUsage>({});
  const [gpsDistances, setGpsDistances] = useState<Record<string, number>>({});
  const [selectedTrip, setSelectedTrip] = useState<TripSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextTrips, nextVehicles] = await Promise.all([fetchTripsReadOnly(100), fetchVehiclesReadOnly(200)]);
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
    void loadData();
  }, [loadData]);

  const filtered = useMemo(
    () => (selectedVehicleId ? trips.filter((trip) => trip.vehicleId === selectedVehicleId) : trips),
    [selectedVehicleId, trips]
  );
  const completedCount = useMemo(() => filtered.filter((trip) => trip.status === 'completed').length, [filtered]);

  async function exportMonthlyLog() {
    if (filtered.length === 0) {
      Alert.alert('내보낼 기록 없음', '선택한 조건의 운행 기록이 없습니다.');
      return;
    }

    const rows = [
      '차량번호,상태,출발,도착,출발지,목적지,운행목적,운행자,사용자,계기판총주행거리,계기판운행거리,실제이동거리,소모유류,OBD연료,주유추정',
      ...filtered.map((trip) => {
        const fuel = trip.vehicleId && obdSnapshot[trip.vehicleId]?.fuelPercent !== null && obdSnapshot[trip.vehicleId]?.fuelPercent !== undefined
          ? `${obdSnapshot[trip.vehicleId].fuelPercent}%`
          : '';
        const operator = [trip.operatorRank, trip.operatorName].filter(Boolean).join(' ');
        const user = [trip.userRank, trip.userName].filter(Boolean).join(' ');
        return [
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
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
      }),
    ];
    await Share.share({
      title: '월장비운행증',
      message: rows.join('\n'),
    });
  }

  return (
    <RebuildScreen
      title="기록"
      metrics={[{ label: '완료', value: `${completedCount}건` }]}
      actionLabel="새로고침"
      onAction={() => void loadData()}>
      <Pressable style={styles.exportBtn} onPress={() => void exportMonthlyLog()}>
        <Text style={styles.exportBtnText}>월장비운행증 내보내기</Text>
      </Pressable>

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
                <StatusLine label="실제 이동거리" value={gpsDistanceLabel(gpsDistances, selectedTrip.id)} />
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
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  exportBtn: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#8EA7FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  exportBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  routeText: { color: '#52607D', fontSize: 14, fontWeight: '800', marginTop: 10 },
  modalDim: { flex: 1, backgroundColor: 'rgba(80,88,120,0.36)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  detailModal: { width: '100%', borderRadius: 18, backgroundColor: '#FFFDFB', padding: 18 },
  modalTitle: { color: '#222B45', fontSize: 20, fontWeight: '900' },
  modalSub: { color: '#7180A3', fontSize: 13, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  modalClose: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#8EA7FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  modalCloseText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
