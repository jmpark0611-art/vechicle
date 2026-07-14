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
  userName: string | null;
};

export type ManualTripInput = {
  vehicleId: string;
  startPlace: string;
  endPlace: string;
  purpose?: string;
  operatorName?: string;
  userName?: string;
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
  user_name?: string | null;
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
    userName: row.user_name ?? null,
  };
}

const BASIC_TRIP_SELECT = 'id,vehicle_id,start_place,end_place,start_time,end_time,status';
const EXTENDED_TRIP_SELECT = 'id,vehicle_id,start_place,end_place,start_time,end_time,status,purpose,operator_name,user_name';

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

async function insertTrip(payload: Record<string, string | null>) {
  return withRequestTimeout(
    supabase
      .from('trips')
      .insert(payload)
      .select(tripSelect(true))
      .single(),
    '운행 시작'
  ) as Promise<QueryResult<TripRow>>;
}

async function insertBasicTrip(payload: Record<string, string | null>) {
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
    user_name: input.userName?.trim() || null,
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

export async function completeManualTrip(tripId: string, endPlace: string): Promise<void> {
  const result = await withRequestTimeout(
    supabase
      .from('trips')
      .update({
        end_place: endPlace.trim(),
        end_time: new Date().toISOString(),
        status: 'completed',
      })
      .eq('id', tripId),
    '운행 종료'
  );

  if (result.error) {
    throw new Error(result.error.message);
  }
}
