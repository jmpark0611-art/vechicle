import { useCallback, useEffect, useMemo, useState } from 'react';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchTripsReadOnly, type TripSummary } from '@/lib/readonly-data';

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
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTrips = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setTrips(await fetchTripsReadOnly());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '운행 기록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  const inProgressCount = useMemo(() => trips.filter((trip) => trip.status === 'in_progress').length, [trips]);
  const completedCount = useMemo(() => trips.filter((trip) => trip.status === 'completed').length, [trips]);

  return (
    <RebuildScreen
      title="운행 기록"
      metrics={[
        { label: '운행중', value: `${inProgressCount}건` },
        { label: '완료', value: `${completedCount}건` },
      ]}
      actionLabel="새로고침"
      onAction={() => void loadTrips()}>

      {isLoading ? (
        <LoadingCard label="운행 기록 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : trips.length === 0 ? (
        <SectionCard title="기록 없음" body="운행 기록이 없습니다." />
      ) : (
        trips.map((trip) => (
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
