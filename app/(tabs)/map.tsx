import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VehicleMap } from '../../components/vehicle-map';
import { generateVehicleMapHtml, VehiclePosition } from '../../lib/map-html';
import { getStoredRole } from '../../lib/role';
import { supabase } from '../../lib/supabase';

const FALLBACK_POLL_MS = 60_000;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [html, setHtml] = useState('');
  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommander, setIsCommander] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    getStoredRole().then((role) => setIsCommander(role === 'commander'));
  }, []);

  const fetchPositions = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

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
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isCommander === null) return;

    fetchPositions();

    const channel = supabase
      .channel('map-vehicle-positions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gps_points' }, fetchPositions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, fetchPositions)
      .subscribe();

    const fallbackTimer = setInterval(fetchPositions, FALLBACK_POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(fallbackTimer);
    };
  }, [fetchPositions, isCommander]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    fetchPositions();
  }, [fetchPositions]);

  if (isCommander === null) {
    return (
      <View style={[styles.container, styles.centerBox, { paddingTop: insets.top }]}>
        <ActivityIndicator color="#F59E0B" size="large" />
      </View>
    );
  }


  if (isCommander === false) {
    return (
      <View style={[styles.container, styles.centerBox, { paddingTop: insets.top }]}>
        <Text style={styles.accessTitle}>수송부 간부 전용</Text>
        <Text style={styles.accessDesc}>차량 위치 화면은 수송부 간부만 사용할 수 있습니다.</Text>
        <TouchableOpacity
          style={styles.roleBtn}
          onPress={() => router.replace('/role-select')}>
          <Text style={styles.roleBtnText}>역할 변경하기</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
          <ActivityIndicator color="#F59E0B" size="large" />
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
    backgroundColor: '#07101C',
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  accessTitle: {
    color: '#EAF0F8',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  accessDesc: {
    color: '#5A7A9A',
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  roleBtn: {
    backgroundColor: '#F59E0B',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  roleBtnText: {
    color: '#07101C',
    fontSize: 15,
    fontWeight: '700',
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#0D1B2A',
    borderBottomColor: 'rgba(255,255,255,0.07)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: {
    color: '#EAF0F8',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#5A7A9A',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: 'rgba(96,165,250,0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  refreshText: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 10,
    margin: 12,
    padding: 12,
  },
  errorText: {
    color: '#EF4444',
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
    color: '#5A7A9A',
    fontSize: 14,
    fontWeight: '500',
  },
  map: {
    flex: 1,
  },
  listPanel: {
    backgroundColor: '#0D1B2A',
    borderTopColor: 'rgba(255,255,255,0.07)',
    borderTopWidth: 1,
    maxHeight: 220,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  vehicleRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255,255,255,0.05)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: 8,
  },
  vehicleRowLeft: {
    flex: 1,
    minWidth: 0,
  },
  vehicleNum: {
    color: '#EAF0F8',
    fontSize: 15,
    fontWeight: '700',
  },
  vehicleRoute: {
    color: '#5A7A9A',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  vehicleGpsTime: {
    color: '#3D607A',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 1,
  },
  badges: {
    alignItems: 'flex-end',
    gap: 4,
  },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeGray: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  badgeGrayText: {
    color: '#5A7A9A',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeYellow: {
    backgroundColor: 'rgba(245,158,11,0.1)',
  },
  badgeYellowText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeRed: {
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  badgeRedText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeOrange: {
    backgroundColor: 'rgba(234,88,12,0.1)',
  },
  badgeOrangeText: {
    color: '#EA580C',
    fontSize: 11,
    fontWeight: '600',
  },
});
