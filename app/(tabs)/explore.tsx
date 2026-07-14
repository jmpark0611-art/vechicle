import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
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

function statusLabel(status: string) {
  if (status === 'in_progress') return '운행중';
  if (status === 'completed') return '완료';
  if (status === 'canceled') return '무효';
  return status;
}

export default function RecordsScreen() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextTrips, nextVehicles] = await Promise.all([fetchTripsReadOnly(100), fetchVehiclesReadOnly(50)]);
      setTrips(nextTrips);
      setVehicles(nextVehicles);
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
    () => selectedVehicleId ? trips.filter((t) => t.vehicleId === selectedVehicleId) : trips,
    [trips, selectedVehicleId]
  );

  const inProgressCount = useMemo(() => filtered.filter((t) => t.status === 'in_progress').length, [filtered]);
  const completedCount = useMemo(() => filtered.filter((t) => t.status === 'completed').length, [filtered]);

  return (
    <RebuildScreen
      title="운행 기록"
      metrics={[
        { label: '운행중', value: `${inProgressCount}건` },
        { label: '완료', value: `${completedCount}건` },
      ]}
      actionLabel="새로고침"
      onAction={() => void loadData()}>

      {vehicles.length > 0 && (
        <SectionCard title="차량 필터">
          <View style={styles.vehicleList}>
            <Pressable
              style={[styles.vehiclePill, selectedVehicleId === null && styles.vehiclePillActive]}
              onPress={() => setSelectedVehicleId(null)}>
              <Text style={[styles.vehiclePillText, selectedVehicleId === null && styles.vehiclePillTextActive]}>
                전체
              </Text>
            </Pressable>
            {vehicles.map((vehicle) => (
              <Pressable
                key={vehicle.id}
                style={[styles.vehiclePill, selectedVehicleId === vehicle.id && styles.vehiclePillActive]}
                onPress={() => setSelectedVehicleId(vehicle.id)}>
                <Text style={[styles.vehiclePillText, selectedVehicleId === vehicle.id && styles.vehiclePillTextActive]}>
                  {vehicle.vehicleNumber}
                </Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      )}

      {isLoading ? (
        <LoadingCard label="운행 기록 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : filtered.length === 0 ? (
        <SectionCard title="기록 없음" body="조건에 맞는 운행 기록이 없습니다." />
      ) : (
        filtered.map((trip) => (
          <SectionCard
            key={trip.id}
            title={`${trip.vehicleNumber} · ${statusLabel(trip.status)}`}>
            <StatusLine label="경로" value={`${trip.startPlace ?? '-'} → ${trip.endPlace ?? '-'}`} />
            <StatusLine label="출발" value={formatTripTime(trip.startTime)} />
            <StatusLine label="도착" value={formatTripTime(trip.endTime)} />
            {trip.purpose ? <StatusLine label="목적" value={trip.purpose} /> : null}
            {trip.operatorName ? <StatusLine label="운전자" value={trip.operatorName} /> : null}
            {trip.userName ? <StatusLine label="사용자" value={trip.userName} /> : null}
          </SectionCard>
        ))
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  vehicleList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  vehiclePill: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  vehiclePillActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  vehiclePillText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  vehiclePillTextActive: { color: '#2563EB' },
});
