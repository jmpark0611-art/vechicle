import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchTripsReadOnly, fetchVehiclesReadOnly, getSupabaseReadSource } from '@/lib/readonly-data';
import { clearStoredRole, getStoredRole } from '@/lib/role';
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
    if (timeoutId) clearTimeout(timeoutId);
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
    return { label, table, status: isMissingTable(result.error) ? 'missing' : 'error', value: result.error.message };
  }
  const count = result.count ?? 0;
  return { label, table, status: count > 0 ? 'ok' : 'empty', value: `${count.toLocaleString('ko-KR')}건` };
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
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  useEffect(() => {
    void getStoredRole().then(setCurrentRole);
  }, []);

  async function handleChangeRole() {
    Alert.alert('역할 변경', '현재 역할을 해제하고 선택 화면으로 이동합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '변경',
        onPress: async () => {
          await clearStoredRole();
          router.replace('/role-select');
        },
      },
    ]);
  }

  const runReadCheck = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [vehicles, trips, gpsPoints, maintenanceRecords, speedZones, obdLogs] = await Promise.all([
        fetchVehiclesReadOnly(5),
        fetchTripsReadOnly(5),
        countTable('GPS 위치', 'gps_points'),
        countTable('정비 기록', 'maintenance_records'),
        countTable('속도구역', 'speed_zones'),
        countTable('OBD 기록', 'obd_logs'),
      ]);
      setResult({
        vehicles: vehicles.length,
        trips: trips.length,
        tableChecks: [gpsPoints, maintenanceRecords, speedZones, obdLogs],
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
      metrics={[
        { label: 'Expo SDK', value: sdkVersion },
        { label: '점검 오류', value: `${failedChecks}건` },
      ]}
      actionLabel="다시 점검"
      onAction={() => void runReadCheck()}>

      <SectionCard title="현재 설정">
        <StatusLine
          label="역할"
          value={currentRole === 'commander' ? '수송부 모드' : currentRole === 'admin' ? '관리자 모드' : currentRole === 'driver' ? '운행 모드' : '-'}
        />
        <StatusLine label="Supabase" value={getSupabaseReadSource()} />
        {result ? (
          <>
            <StatusLine label="차량" value={`${result.vehicles}건`} />
            <StatusLine label="운행" value={`${result.trips}건`} />
          </>
        ) : null}
        <Pressable style={styles.changeRoleBtn} onPress={() => void handleChangeRole()}>
          <Text style={styles.changeRoleBtnText}>역할 변경</Text>
        </Pressable>
        {currentRole === 'commander' ? <Text style={styles.pinHint}>수송부 PIN은 1862로 고정되어 있습니다.</Text> : null}
        {currentRole === 'admin' ? <Text style={styles.pinHint}>관리자 PIN은 임시로 1862입니다.</Text> : null}
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="점검 중" />
      ) : errorMessage ? (
        <SectionCard title="점검 오류" body={errorMessage} />
      ) : (
        <SectionCard title="기능 테이블">
          {result?.tableChecks.map((item) => (
            <StatusLine key={item.table} label={item.label} value={`${statusText(item.status)} · ${item.value}`} />
          ))}
        </SectionCard>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  changeRoleBtn: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  changeRoleBtnText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  pinHint: { color: '#94A3B8', fontSize: 12, fontWeight: '500', marginTop: 10 },
});
