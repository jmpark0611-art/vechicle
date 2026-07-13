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
};

export type ManualTripInput = {
  vehicleId: string;
  startPlace: string;
  endPlace: string;
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
};

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
  };
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

export async function fetchTripsReadOnly(limit = 20): Promise<TripSummary[]> {
  const [vehicles, tripsResult] = await Promise.all([
    fetchVehiclesReadOnly(200),
    withRequestTimeout(
      supabase
        .from('trips')
        .select('id, vehicle_id, start_place, end_place, start_time, end_time, status')
        .order('start_time', { ascending: false })
        .limit(limit),
      '운행 기록'
    ),
  ]);

  if (tripsResult.error) {
    throw new Error(tripsResult.error.message);
  }

  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicleNumber]));
  return ((tripsResult.data ?? []) as TripRow[]).map((trip) => mapTrip(trip, vehicleById));
}

export async function fetchActiveTrips(limit = 20): Promise<TripSummary[]> {
  const [vehicles, tripsResult] = await Promise.all([
    fetchVehiclesReadOnly(200),
    withRequestTimeout(
      supabase
        .from('trips')
        .select('id, vehicle_id, start_place, end_place, start_time, end_time, status')
        .eq('status', 'in_progress')
        .order('start_time', { ascending: false })
        .limit(limit),
      '진행 중 운행'
    ),
  ]);

  if (tripsResult.error) {
    throw new Error(tripsResult.error.message);
  }

  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.vehicleNumber]));
  return ((tripsResult.data ?? []) as TripRow[]).map((trip) => mapTrip(trip, vehicleById));
}

export async function startManualTrip(input: ManualTripInput): Promise<TripSummary> {
  const result = await withRequestTimeout(
    supabase
      .from('trips')
      .insert({
        vehicle_id: input.vehicleId,
        start_place: input.startPlace.trim(),
        end_place: input.endPlace.trim(),
        start_time: new Date().toISOString(),
        status: 'in_progress',
      })
      .select('id, vehicle_id, start_place, end_place, start_time, end_time, status')
      .single(),
    '운행 시작'
  );

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
