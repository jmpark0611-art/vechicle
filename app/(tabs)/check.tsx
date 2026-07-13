import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchTripsReadOnly, fetchVehiclesReadOnly, getSupabaseReadSource } from '@/lib/readonly-data';
import { supabase } from '@/lib/supabase';

type TableCheck = {
  label: string;
  table: string;
  status: 'ok' | 'empty' | 'missing' | 'error';
  value: string;
};

type DiagnosticResult = {
  vehicles: number;
  trips: number;
  tableChecks: TableCheck[];
};

const REQUEST_TIMEOUT_MS = 8_000;

async function withRequestTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 응답 시간이 초과되었습니다.`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isMissingTable(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|could not find/i.test(error.message);
}

async function countTable(label: string, table: string): Promise<TableCheck> {
  const result = await withRequestTimeout(
    supabase.from(table).select('id', { count: 'exact', head: true }),
    `${label} 점검`
  );

  if (result.error) {
    return {
      label,
      table,
      status: isMissingTable(result.error) ? 'missing' : 'error',
      value: result.error.message,
    };
  }

  const count = result.count ?? 0;
  return {
    label,
    table,
    status: count > 0 ? 'ok' : 'empty',
    value: `${count.toLocaleString('ko-KR')}건`,
  };
}

function statusText(status: TableCheck['status']) {
  if (status === 'ok') return '정상';
  if (status === 'empty') return '비어 있음';
  if (status === 'missing') return '테이블 없음';
  return '오류';
}

export default function CheckScreen() {
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? '54';
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runReadCheck = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [vehicles, trips, gpsPoints, maintenanceRecords, speedZones] = await Promise.all([
        fetchVehiclesReadOnly(5),
        fetchTripsReadOnly(5),
        countTable('GPS 위치', 'gps_points'),
        countTable('정비 기록', 'maintenance_records'),
        countTable('제한속도 구역', 'speed_zones'),
      ]);
      setResult({
        vehicles: vehicles.length,
        trips: trips.length,
        tableChecks: [gpsPoints, maintenanceRecords, speedZones],
      });
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : 'Supabase 점검에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void runReadCheck();
  }, [runReadCheck]);

  const failedChecks = result?.tableChecks.filter((item) => item.status === 'missing' || item.status === 'error').length ?? 0;

  return (
    <RebuildScreen
      title="시스템 점검"
      subtitle="앱, Supabase 연결, GPS/정비/제한속도 테이블 상태를 한 화면에서 확인합니다."
      metrics={[
        { label: 'Expo SDK', value: sdkVersion },
        { label: 'Supabase', value: errorMessage ? '오류' : '연결' },
        { label: '차량 샘플', value: `${result?.vehicles ?? 0}건` },
        { label: '점검 오류', value: `${failedChecks}건` },
      ]}
      actionLabel="점검 다시 실행"
      onAction={() => void runReadCheck()}>
      <SectionCard title="현재 기준" body="클린 리빌드 브랜치에서 기능을 작은 단위로 복구하고 있습니다.">
        <StatusLine label="브랜치" value="rebuild/clean-sdk54-start" />
      </SectionCard>

      <SectionCard title="Supabase 설정" body="환경변수 또는 fallback 설정으로 연결된 Supabase 정보를 표시합니다.">
        <StatusLine label="출처" value={getSupabaseReadSource()} />
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="Supabase 점검 중" />
      ) : errorMessage ? (
        <SectionCard title="점검 오류" body={errorMessage} />
      ) : (
        <>
          <SectionCard title="기본 테이블" body="차량과 운행 기록 읽기 경로를 확인했습니다.">
            <StatusLine label="차량" value={`${result?.vehicles ?? 0}건`} />
            <StatusLine label="운행" value={`${result?.trips ?? 0}건`} />
          </SectionCard>

          <SectionCard title="기능 테이블" body="GPS 저장, 정비 기록, 제한속도 구역 기능에 필요한 테이블 상태입니다.">
            {result?.tableChecks.map((item) => (
              <StatusLine key={item.table} label={item.label} value={`${statusText(item.status)} · ${item.value}`} />
            ))}
          </SectionCard>
        </>
      )}

      <SectionCard
        title="실기기 확인"
        body="APK 설치 후 운행 시작, GPS 권한 허용, 운행 종료, 차량 정비 교체완료, 제한속도 구역 저장 순서로 확인하면 됩니다."
      />
    </RebuildScreen>
  );
}
