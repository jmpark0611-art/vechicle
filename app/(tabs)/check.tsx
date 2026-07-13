import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchTripsReadOnly, fetchVehiclesReadOnly, getSupabaseReadSource } from '@/lib/readonly-data';

type ReadCheck = {
  vehicles: number;
  trips: number;
};

export default function CheckScreen() {
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? '54';
  const [result, setResult] = useState<ReadCheck | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runReadCheck = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [vehicles, trips] = await Promise.all([fetchVehiclesReadOnly(5), fetchTripsReadOnly(5)]);
      setResult({ vehicles: vehicles.length, trips: trips.length });
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : 'Supabase 읽기 점검에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void runReadCheck();
  }, [runReadCheck]);

  return (
    <RebuildScreen
      title="시스템 점검"
      subtitle="클린 재구축 1단계 기준점 위에 Supabase 읽기 연결을 추가했습니다."
      metrics={[
        { label: 'Expo SDK', value: sdkVersion },
        { label: 'Supabase', value: errorMessage ? '오류' : '읽기' },
      ]}
      actionLabel="읽기 점검 다시 실행"
      onAction={() => void runReadCheck()}>
      <SectionCard title="앱 기준점" body="build-96에서 실기기 실행이 확인된 클린 기준점을 유지합니다.">
        <StatusLine label="브랜치" value="rebuild/clean-sdk54-start" />
      </SectionCard>

      <SectionCard title="Supabase 설정" body="환경변수 또는 fallback 설정으로 읽기 전용 연결을 수행합니다.">
        <StatusLine label="출처" value={getSupabaseReadSource()} />
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="Supabase 읽기 점검 중" />
      ) : errorMessage ? (
        <SectionCard title="읽기 오류" body={errorMessage} />
      ) : (
        <SectionCard title="읽기 점검 통과" body="차량과 운행 기록 테이블을 읽었습니다.">
          <StatusLine label="차량 샘플" value={`${result?.vehicles ?? 0}건`} />
          <StatusLine label="운행 샘플" value={`${result?.trips ?? 0}건`} />
        </SectionCard>
      )}

      <SectionCard
        title="아직 보류"
        body="GPS, 지도, OBD/BLE, 저장 기능은 아직 다시 붙이지 않았습니다. APK 테스트 가능한 작은 단계로만 복구합니다."
      />
    </RebuildScreen>
  );
}
