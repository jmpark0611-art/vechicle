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

const READ_TIMEOUT_MS = 10_000;

async function withReadTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 응답 시간이 초과되었습니다.`)), READ_TIMEOUT_MS);
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

export function getSupabaseReadSource() {
  return `${supabaseConfig.source} · ${supabaseConfig.urlHost}`;
}

export async function fetchVehiclesReadOnly(limit = 20): Promise<VehicleSummary[]> {
  const result = await withReadTimeout(
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

  return ((result.data ?? []) as VehicleRow[]).map((vehicle) => ({
    id: vehicle.id,
    vehicleNumber: vehicle.vehicle_number ?? '번호 없음',
    createdAt: vehicle.created_at,
  }));
}

export async function fetchTripsReadOnly(limit = 20): Promise<TripSummary[]> {
  const [vehicles, tripsResult] = await Promise.all([
    fetchVehiclesReadOnly(200),
    withReadTimeout(
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

  return ((tripsResult.data ?? []) as TripRow[]).map((trip) => ({
    id: trip.id,
    vehicleId: trip.vehicle_id,
    vehicleNumber: trip.vehicle_id ? vehicleById.get(trip.vehicle_id) ?? '차량 미확인' : '차량 미지정',
    startPlace: trip.start_place,
    endPlace: trip.end_place,
    startTime: trip.start_time,
    endTime: trip.end_time,
    status: trip.status ?? 'unknown',
  }));
}
