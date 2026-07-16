import { supabase, supabaseConfig } from './supabase';

export type VehicleSummary = {
  id: string;
  vehicleNumber: string;
  createdAt: string | null;
};

export type TripSummary = {
  id: string;
  vehicleId: string | null;
  vehicleNumber: string;
  startPlace: string | null;
  endPlace: string | null;
  startTime: string | null;
  endTime: string | null;
  status: string;
  purpose: string | null;
  operatorName: string | null;
  operatorRank: string | null;
  userName: string | null;
  userRank: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
};

export type ManualTripInput = {
  vehicleId: string;
  startPlace: string;
  endPlace: string;
  purpose?: string;
  operatorName?: string;
  operatorRank?: string;
  userName?: string;
  userRank?: string;
  startOdometer?: number;
};

const REQUEST_TIMEOUT_MS = 10_000;

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

type VehicleRow = {
  id: string;
  vehicle_number: string | null;
  created_at: string | null;
};

type TripRow = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  purpose?: string | null;
  operator_name?: string | null;
  operator_rank?: string | null;
  user_name?: string | null;
  user_rank?: string | null;
  start_odometer?: number | null;
  end_odometer?: number | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

function isMissingColumnError(error: { code?: string; message: string } | null) {
  if (!error) return false;
  return error.code === 'PGRST204' || /column|schema cache|could not find/i.test(error.message);
}

function mapVehicle(row: VehicleRow): VehicleSummary {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number ?? '번호 없음',
    createdAt: row.created_at,
  };
}

function mapTrip(row: TripRow, vehicleById: Map<string, string>): TripSummary {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleNumber: row.vehicle_id ? vehicleById.get(row.vehicle_id) ?? '차량 미확인' : '차량 미지정',
    startPlace: row.start_place,
    endPlace: row.end_place,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status ?? 'unknown',
    purpose: row.purpose ?? null,
    operatorName: row.operator_name ?? null,
    operatorRank: row.operator_rank ?? null,
    userName: row.user_name ?? null,
    userRank: row.user_rank ?? null,
    startOdometer: row.start_odometer ?? null,
    endOdometer: row.end_odometer ?? null,
  };
}

const BASIC_TRIP_SELECT = 'id,vehicle_id,start_place,end_place,start_time,end_time,status';
const EXTENDED_TRIP_SELECT = 'id,vehicle_id,start_place,end_place,start_time,end_time,status,purpose,operator_name,operator_rank,user_name,user_rank,start_odometer,end_odometer';

function tripSelect(includeExtended = true) {
  return includeExtended ? EXTENDED_TRIP_SELECT : BASIC_TRIP_SELECT;
}

export function getSupabaseReadSource() {
  return `${supabaseConfig.source} · ${supabaseConfig.urlHost}`;
}

export async function fetchVehiclesReadOnly(limit = 20): Promise<VehicleSummary[]> {
  const result = await withRequestTimeout(
    supabase
      .from('vehicles')
      .select('id, vehicle_number, created_at')
      .order('vehicle_number', { ascending: true })
      .limit(limit),
    '차량 목록'
  );

  if (result.error) {
    throw new Error(result.error.message);
  }

  return ((result.data ?? []) as VehicleRow[]).map(mapVehicle);
}

export async function createVehicle(vehicleNumber: string): Promise<VehicleSummary> {
  const trimmed = vehicleNumber.trim();
  if (!trimmed) {
    throw new Error('차량번호를 입력해 주세요.');
  }

  const result = await withRequestTimeout(
    supabase
      .from('vehicles')
      .insert({ vehicle_number: trimmed })
      .select('id, vehicle_number, created_at')
      .single(),
    '차량 등록'
  ) as QueryResult<VehicleRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return mapVehicle(result.data as VehicleRow);
}

async function fetchTripsWithSelect(limit: number, activeOnly: boolean, includeExtended: boolean) {
  let query = supabase.from('trips').select(tripSelect(includeExtended));
  if (activeOnly) {
    query = query.eq('status', 'in_progress');
  }
  return withRequestTimeout(query.order('start_time', { ascending: false }).limit(limit), activeOnly ? '진행 중 운행' : '운행 기록');
}

async function fetchTripRows(limit: number, activeOnly: boolean): Promise<TripRow[]> {
  const extended = await fetchTripsWithSelect(limit, activeOnly, true);
  if (!extended.error) {
    return (extended.data ?? []) as unknown as TripRow[];
  }

  if (!isMissingColumnError(extended.error)) {
    throw new Error(extended.error.message);
  }

  const basic = await fetchTripsWithSelect(limit, activeOnly, false);
  if (basic.error) {
    throw new Error(basic.error.message);
  }

  return (basic.data ?? []) as unknown as TripRow[];
}

export async function fetchTripsReadOnly(limit = 20): Promise<TripSummary[]> {
  const [vehicles, trips] = await Promise.all([fetchVehiclesReadOnly(200), fetchTripRows(limit, false)]);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicleNumber]));
  return trips.map((trip) => mapTrip(trip, vehicleById));
}

export async function fetchActiveTrips(limit = 20): Promise<TripSummary[]> {
  const [vehicles, trips] = await Promise.all([fetchVehiclesReadOnly(200), fetchTripRows(limit, true)]);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicleNumber]));
  return trips.map((trip) => mapTrip(trip, vehicleById));
}

export async function fetchLatestVehicleOdometers(vehicleIds: string[]): Promise<Record<string, number>> {
  if (vehicleIds.length === 0) {
    return {};
  }

  const result = await withRequestTimeout(
    supabase
      .from('trips')
      .select('vehicle_id,start_odometer,end_odometer,start_time,end_time')
      .in('vehicle_id', vehicleIds)
      .order('end_time', { ascending: false, nullsFirst: false })
      .order('start_time', { ascending: false })
      .limit(500),
    '차량 계기판 기록'
  );

  if (result.error) {
    if (isMissingColumnError(result.error)) {
      return {};
    }
    throw new Error(result.error.message);
  }

  const latest: Record<string, number> = {};
  for (const row of (result.data ?? []) as TripRow[]) {
    if (!row.vehicle_id || latest[row.vehicle_id] !== undefined) continue;
    const endOdometer = typeof row.end_odometer === 'number' && row.end_odometer > 0 ? row.end_odometer : null;
    const startOdometer = typeof row.start_odometer === 'number' && row.start_odometer > 0 ? row.start_odometer : null;
    const odometer = endOdometer ?? startOdometer;
    if (odometer !== null) {
      latest[row.vehicle_id] = Math.round(odometer);
    }
  }

  return latest;
}

async function insertTrip(payload: Record<string, string | number | null>) {
  return withRequestTimeout(
    supabase
      .from('trips')
      .insert(payload)
      .select(tripSelect(true))
      .single(),
    '운행 시작'
  ) as Promise<QueryResult<TripRow>>;
}

async function insertBasicTrip(payload: Record<string, string | number | null>) {
  return withRequestTimeout(
    supabase
      .from('trips')
      .insert(payload)
      .select(tripSelect(false))
      .single(),
    '운행 시작'
  ) as Promise<QueryResult<TripRow>>;
}

export async function startManualTrip(input: ManualTripInput): Promise<TripSummary> {
  const now = new Date().toISOString();
  const basePayload = {
    vehicle_id: input.vehicleId,
    start_place: input.startPlace.trim(),
    end_place: input.endPlace.trim(),
    start_time: now,
    status: 'in_progress',
  };
  const extendedPayload = {
    ...basePayload,
    purpose: input.purpose?.trim() || null,
    operator_name: input.operatorName?.trim() || null,
    operator_rank: input.operatorRank?.trim() || null,
    user_name: input.userName?.trim() || null,
    user_rank: input.userRank?.trim() || null,
    start_odometer: input.startOdometer ?? null,
  };

  let result = await insertTrip(extendedPayload);
  if (result.error && isMissingColumnError(result.error)) {
    result = await insertBasicTrip(basePayload);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  const vehicles = await fetchVehiclesReadOnly(200);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicleNumber]));
  return mapTrip(result.data as TripRow, vehicleById);
}

export type MonthlyTripRow = {
  id: string;
  startTime: string | null;
  endTime: string | null;
  startPlace: string | null;
  endPlace: string | null;
  purpose: string | null;
  operatorName: string | null;
  userName: string | null;
  dailyKm: number | null;
};

export async function fetchMonthlyTrips(vehicleId: string, year: number, month: number): Promise<MonthlyTripRow[]> {
  const from = new Date(year, month - 1, 1).toISOString();
  const to = new Date(year, month, 1).toISOString();

  const extended = await withRequestTimeout(
    supabase
      .from('trips')
      .select('id,start_time,end_time,start_place,end_place,status,purpose,operator_name,user_name,daily_km')
      .eq('vehicle_id', vehicleId)
      .gte('start_time', from)
      .lt('start_time', to)
      .order('start_time', { ascending: true }),
    '월 운행증'
  );

  if (!extended.error) {
    return ((extended.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      startTime: (r.start_time as string | null) ?? null,
      endTime: (r.end_time as string | null) ?? null,
      startPlace: (r.start_place as string | null) ?? null,
      endPlace: (r.end_place as string | null) ?? null,
      purpose: (r.purpose as string | null) ?? null,
      operatorName: (r.operator_name as string | null) ?? null,
      userName: (r.user_name as string | null) ?? null,
      dailyKm: typeof r.daily_km === 'number' ? r.daily_km : null,
    }));
  }

  if (!isMissingColumnError(extended.error)) {
    throw new Error(extended.error.message);
  }

  const basic = await withRequestTimeout(
    supabase
      .from('trips')
      .select('id,start_time,end_time,start_place,end_place,status')
      .eq('vehicle_id', vehicleId)
      .gte('start_time', from)
      .lt('start_time', to)
      .order('start_time', { ascending: true }),
    '월 운행증'
  );

  if (basic.error) {
    throw new Error(basic.error.message);
  }

  return ((basic.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    startPlace: (r.start_place as string | null) ?? null,
    endPlace: (r.end_place as string | null) ?? null,
    purpose: null,
    operatorName: null,
    userName: null,
    dailyKm: null,
  }));
}

export async function completeManualTrip(
  tripId: string,
  endPlace: string,
  endOdometer?: number,
  startOdometer?: number,
): Promise<void> {
  const update: Record<string, string | number | null> = {
    end_place: endPlace.trim(),
    end_time: new Date().toISOString(),
    status: 'completed',
  };
  if (endOdometer !== undefined && endOdometer > 0) {
    update.end_odometer = endOdometer;
    if (startOdometer !== undefined && startOdometer > 0 && endOdometer > startOdometer) {
      update.daily_km = endOdometer - startOdometer;
    }
  }

  const result = await withRequestTimeout(
    supabase.from('trips').update(update).eq('id', tripId),
    '운행 종료'
  );

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function cancelManualTrip(tripId: string): Promise<void> {
  const result = await withRequestTimeout(
    supabase.from('trips').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', tripId),
    '운행 취소'
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
}
