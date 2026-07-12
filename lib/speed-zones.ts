import { supabase } from './supabase';
import { getStoredUnitCode } from './unit';

export type SpeedZone = {
  id: string;
  unit_code: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  speed_limit_kmh: number;
};

export async function fetchSpeedZones(): Promise<SpeedZone[]> {
  const unitCode = await getStoredUnitCode();
  const query = supabase
    .from('speed_zones')
    .select('id, unit_code, name, center_lat, center_lng, radius_m, speed_limit_kmh')
    .order('created_at', { ascending: true });
  if (unitCode) query.eq('unit_code', unitCode);
  const { data } = await query;
  return (data ?? []) as SpeedZone[];
}

export async function addSpeedZone(
  zone: Omit<SpeedZone, 'id'>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('speed_zones').insert(zone);
  return { error: error ? error.message : null };
}

export async function deleteSpeedZone(id: string): Promise<void> {
  await supabase.from('speed_zones').delete().eq('id', id);
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getViolatedZone(
  lat: number,
  lng: number,
  speedKmh: number,
  zones: SpeedZone[]
): SpeedZone | null {
  for (const zone of zones) {
    const dist = haversineMeters(lat, lng, zone.center_lat, zone.center_lng);
    if (dist <= zone.radius_m && speedKmh > zone.speed_limit_kmh) {
      return zone;
    }
  }
  return null;
}

export function isInsideAnyZone(lat: number, lng: number, zones: SpeedZone[]): SpeedZone | null {
  for (const zone of zones) {
    const dist = haversineMeters(lat, lng, zone.center_lat, zone.center_lng);
    if (dist <= zone.radius_m) return zone;
  }
  return null;
}
