import { useCallback, useEffect, useMemo, useState } from 'react';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { loadSyncedObdSnapshot, type ObdSnapshot } from '@/lib/obd-data';
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
  if (status === 'in_progress') return '운행 중';
  if (status === 'completed') return '완료';
  if (status === 'canceled') return '취소';
  return status;
}

export default function RecordsScreen() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [obdSnapshot, setObdSnapshot] = useState<ObdSnapshot>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextTrips, nextVehicles] = await Promise.all([fetchTripsReadOnly(100), fetchVehiclesReadOnly(50)]);
      const obd = await loadSyncedObdSnapshot(nextVehicles.map((vehicle) => vehicle.id));
      setTrips(nextTrips);
      setVehicles(nextVehicles);
      setObdSnapshot(obd.snapshot);
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
  const inProgressCount = useMemo(() => filtered.filter((trip) => trip.status === 'in_progress').length, [filtered]);
  const completedCount = useMemo(() => filtered.filter((trip) => trip.status === 'completed').length, [filtered]);

  return (
    <RebuildScreen
      title="기록"
      subtitle="월장비운행증과 운행 기록을 이 화면에서 함께 확인합니다."
      metrics={[
        { label: '운행 중', value: `${inProgressCount}건` },
        { label: '완료', value: `${completedCount}건` },
      ]}
      actionLabel="새로고침"
      onAction={() => void loadData()}>
      {vehicles.length > 0 ? (
        <SectionCard title="차량">
          <VehicleDropdown
            vehicles={vehicles}
            selectedVehicleId={selectedVehicleId}
            onSelect={setSelectedVehicleId}
            includeAll
            allLabel="전체 차량"
          />
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
          <SectionCard key={trip.id} title={`${trip.vehicleNumber} · ${statusLabel(trip.status)}`}>
            <StatusLine label="경로" value={`${trip.startPlace ?? '-'} → ${trip.endPlace ?? '-'}`} />
            <StatusLine label="출발" value={formatTripTime(trip.startTime)} />
            <StatusLine label="도착" value={formatTripTime(trip.endTime)} />
            {trip.purpose ? <StatusLine label="목적" value={trip.purpose} /> : null}
            {trip.operatorName ? <StatusLine label="운전자" value={trip.operatorName} /> : null}
            {trip.userName ? <StatusLine label="사용자" value={trip.userName} /> : null}
            {trip.vehicleId && obdSnapshot[trip.vehicleId]?.fuelPercent !== null && obdSnapshot[trip.vehicleId]?.fuelPercent !== undefined ? (
              <StatusLine label="OBD 연료" value={`${obdSnapshot[trip.vehicleId].fuelPercent}%`} />
            ) : null}
          </SectionCard>
        ))
      )}
    </RebuildScreen>
  );
}
