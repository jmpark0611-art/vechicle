import { useCallback, useEffect, useState } from 'react';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchVehiclesReadOnly, getSupabaseReadSource, type VehicleSummary } from '@/lib/readonly-data';

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadVehicles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setVehicles(await fetchVehiclesReadOnly());
    } catch (error) {
      const message = error instanceof Error ? error.message : '차량 목록을 불러오지 못했습니다.';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  return (
    <RebuildScreen
      title="차량 진단"
      subtitle="Supabase 차량 목록을 읽기 전용으로 연결했습니다. 등록, 수정, OBD 연결은 다음 단계에서 붙입니다."
      metrics={[
        { label: '등록 차량', value: `${vehicles.length}대` },
        { label: '연결 상태', value: errorMessage ? '오류' : '읽기' },
        { label: 'OBD', value: '보류' },
        { label: 'DTC', value: '보류' },
      ]}
      actionLabel="차량 목록 새로고침"
      onAction={() => void loadVehicles()}>
      <SectionCard title="Supabase" body="현재 브랜치는 읽기 전용 연결만 수행합니다. 저장 기능은 아직 비활성화되어 있습니다.">
        <StatusLine label="연결" value={getSupabaseReadSource()} />
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="차량 목록을 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="차량 목록 오류" body={errorMessage} />
      ) : vehicles.length === 0 ? (
        <SectionCard title="차량 없음" body="Supabase vehicles 테이블에 표시할 차량이 없습니다." />
      ) : (
        vehicles.map((vehicle) => (
          <SectionCard key={vehicle.id} title={vehicle.vehicleNumber} body="읽기 전용 차량 데이터입니다.">
            <StatusLine label="차량 ID" value={vehicle.id.slice(0, 8)} />
            <StatusLine label="등록일" value={vehicle.createdAt ? vehicle.createdAt.slice(0, 10) : '-'} />
          </SectionCard>
        ))
      )}

      <SectionCard
        title="다음 단계"
        body="이 APK가 안정적으로 열리고 목록이 보이면 차량 등록, 소모품 교체완료, OBD 진단을 작은 단위로 복구합니다."
      />
    </RebuildScreen>
  );
}
