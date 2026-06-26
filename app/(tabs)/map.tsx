import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VehicleMap } from '../../components/vehicle-map';
import { generateVehicleMapHtml, VehiclePosition } from '../../lib/map-html';
import { supabase } from '../../lib/supabase';

const REFRESH_INTERVAL_MS = 30_000;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [html, setHtml] = useState('');
  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const { data: trips, error: tripError } = await supabase
        .from('trips')
        .select('id, vehicle_id, start_place, end_place, vehicles(vehicle_number)')
        .eq('status', 'in_progress');

      if (tripError) throw tripError;

      if (!trips || trips.length === 0) {
        setHtml(generateVehicleMapHtml([]));
        setVehicleCount(0);
        setLastUpdated(new Date());
        setErrorMessage(null);
        setIsLoading(false);
        return;
      }

      const tripIds = trips.map((t) => t.id);
      const { data: gpsData, error: gpsError } = await supabase
        .from('gps_points')
        .select('trip_id, latitude, longitude, speed_kmh, recorded_at')
        .in('trip_id', tripIds)
        .order('recorded_at', { ascending: false })
        .limit(200);

      if (gpsError) throw gpsError;

      const latestByTrip = new Map<string, (typeof gpsData)[0]>();
      for (const point of gpsData ?? []) {
        if (!latestByTrip.has(point.trip_id)) {
          latestByTrip.set(point.trip_id, point);
        }
      }

      const positions: VehiclePosition[] = [];
      for (const trip of trips) {
        const gps = latestByTrip.get(trip.id);
        if (!gps || gps.latitude == null || gps.longitude == null) continue;

        const veh = trip.vehicles as { vehicle_number?: string } | { vehicle_number?: string }[] | null;
        const vehicleNumber = Array.isArray(veh)
          ? (veh[0]?.vehicle_number ?? null)
          : (veh?.vehicle_number ?? null);

        positions.push({
          vehicleNumber: vehicleNumber ?? '미상',
          latitude: gps.latitude,
          longitude: gps.longitude,
          speedKmh: gps.speed_kmh,
          recordedAt: gps.recorded_at,
          startPlace: trip.start_place,
          endPlace: trip.end_place,
        });
      }

      setHtml(generateVehicleMapHtml(positions));
      setVehicleCount(positions.length);
      setLastUpdated(new Date());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '위치 조회 실패');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    timerRef.current = setInterval(fetchPositions, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPositions]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    fetchPositions();
  }, [fetchPositions]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>차량 위치</Text>
          <Text style={styles.subtitle}>
            운행 중 {vehicleCount}대
            {lastUpdated
              ? ` · ${lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
          <Text style={styles.refreshText}>새로고침</Text>
        </TouchableOpacity>
      </View>

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {isLoading && !html ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#2563EB" size="large" />
          <Text style={styles.loadingText}>차량 위치를 불러오는 중...</Text>
        </View>
      ) : (
        <VehicleMap html={html} style={styles.map} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  refreshText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    margin: 12,
    padding: 12,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
  },
  loadingBox: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  map: {
    flex: 1,
  },
});
