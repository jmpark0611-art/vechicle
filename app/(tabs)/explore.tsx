import { useCallback, useEffect, useMemo, useState } from 'react';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchTripsReadOnly, getSupabaseReadSource, type TripSummary } from '@/lib/readonly-data';

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
      subtitle="Supabase 최근 운행 기록을 표시합니다. 필터와 CSV는 다음 단계에서 복구합니다."
      metrics={[
        { label: '최근 기록', value: `${trips.length}건` },
        { label: '운행중', value: `${inProgressCount}건` },
        { label: '완료', value: `${completedCount}건` },
        { label: '연결 상태', value: errorMessage ? '오류' : '읽기' },
      ]}
      actionLabel="기록 새로고침"
      onAction={() => void loadTrips()}>
      <SectionCard title="Supabase" body="운행 기록과 차량 목록을 읽어서 화면에서만 표시합니다.">
        <StatusLine label="연결" value={getSupabaseReadSource()} />
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="운행 기록을 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="운행 기록 오류" body={errorMessage} />
      ) : trips.length === 0 ? (
        <SectionCard title="기록 없음" body="Supabase trips 테이블에 표시할 운행 기록이 없습니다." />
      ) : (
        trips.map((trip) => (
          <SectionCard
            key={trip.id}
            title={`${trip.vehicleNumber} · ${statusLabel(trip.status)}`}
            body={`${trip.startPlace ?? '출발지 없음'} → ${trip.endPlace ?? '목적지 없음'}`}>
            <StatusLine label="시작" value={formatTripTime(trip.startTime)} />
            <StatusLine label="종료" value={formatTripTime(trip.endTime)} />
            {trip.purpose ? <StatusLine label="목적" value={trip.purpose} /> : null}
            {trip.operatorName ? <StatusLine label="운전자" value={trip.operatorName} /> : null}
            {trip.userName ? <StatusLine label="사용자" value={trip.userName} /> : null}
            <StatusLine label="기록 ID" value={trip.id.slice(0, 8)} />
          </SectionCard>
        ))
      )}

      <SectionCard
        title="다음 단계"
        body="수동 운행 저장이 안정화되면 기간 필터, 차량 필터, CSV 내보내기를 복구합니다."
      />
    </RebuildScreen>
  );
}
