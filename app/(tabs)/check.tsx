import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { useRoleGuard } from '@/hooks/use-role-guard';
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

const TABLE_SQL: Record<string, string> = {
  gps_points: `create table public.gps_points (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh double precision,
  recorded_at timestamptz not null default now()
);
alter table public.gps_points enable row level security;
create policy "allow all" on public.gps_points
  for all using (true) with check (true);`,

  maintenance_records: `create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  item_key text not null,
  completed_km numeric not null,
  completed_at timestamptz not null default now()
);
alter table public.maintenance_records enable row level security;
create policy "allow all" on public.maintenance_records
  for all using (true) with check (true);`,

  speed_zones: `create table public.speed_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m numeric not null,
  speed_limit_kmh numeric not null,
  zone_kind text not null default 'circle',
  polygon_points jsonb,
  unit_code text
);
alter table public.speed_zones enable row level security;
create policy "allow all" on public.speed_zones
  for all using (true) with check (true);`,

  obd_logs: `create table public.obd_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id),
  trip_id uuid references public.trips(id),
  rpm integer,
  speed_kmh numeric,
  coolant_temp_c numeric,
  battery_voltage numeric,
  fuel_level_percent numeric,
  engine_load_percent numeric,
  throttle_percent numeric,
  intake_air_temp_c numeric,
  ignition_status text,
  dtc_codes text[],
  recorded_at timestamptz not null default now()
);
alter table public.obd_logs enable row level security;
create policy "allow all" on public.obd_logs
  for all using (true) with check (true);`,
};

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
  useRoleGuard(['commander']);

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
            <View key={item.table}>
              <StatusLine label={item.label} value={`${statusText(item.status)} · ${item.value}`} />
              {item.status === 'missing' && TABLE_SQL[item.table] ? (
                <View style={styles.sqlCard}>
                  <Text style={styles.sqlHint}>Supabase Dashboard → SQL Editor에서 실행하세요</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator style={styles.sqlScroll}>
                    <Text style={styles.sqlText} selectable>{TABLE_SQL[item.table]}</Text>
                  </ScrollView>
                </View>
              ) : null}
            </View>
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
  sqlCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
    marginBottom: 4,
    padding: 10,
  },
  sqlHint: { color: '#64748B', fontSize: 11, marginBottom: 6 },
  sqlScroll: { maxHeight: 160 },
  sqlText: { fontFamily: 'monospace', fontSize: 11, color: '#0F172A', lineHeight: 17 },
});
