import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VehicleMap } from '../../components/vehicle-map';
import { generateVehicleMapHtml, VehiclePosition } from '../../lib/map-html';
import { getStoredRole } from '../../lib/role';
import {
  addSpeedZone,
  deleteSpeedZone,
  fetchSpeedZones,
  SpeedZone,
} from '../../lib/speed-zones';
import { supabase } from '../../lib/supabase';
import { getStoredUnitCode } from '../../lib/unit';

const FALLBACK_POLL_MS = 60_000;

function getGpsAge(recordedAt: string | null): { text: string; stale: boolean } {
  if (!recordedAt) return { text: '시간 미상', stale: true };
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const stale = ageMs > 5 * 60 * 1000;
  const text = ageMin < 1 ? '방금' : ageMin < 60 ? `${ageMin}분 전` : `${Math.floor(ageMin / 60)}시간 전`;
  return { text, stale };
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [html, setHtml] = useState('');
  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommander, setIsCommander] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  const isFetchingRef = useRef(false);

  // 속도 제한 구역
  const [zones, setZones] = useState<SpeedZone[]>([]);
  const [zoneAddMode, setZoneAddMode] = useState(false);
  const [showZoneList, setShowZoneList] = useState(false);

  // 구역 추가 모달
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneRadius, setZoneRadius] = useState('300');
  const [zoneSpeedLimit, setZoneSpeedLimit] = useState('30');
  const [isSavingZone, setIsSavingZone] = useState(false);

  useEffect(() => {
    getStoredRole().then((role) => setIsCommander(role === 'commander'));
  }, []);

  const loadZones = useCallback(async () => {
    const data = await fetchSpeedZones();
    setZones(data);
  }, []);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  const rebuildHtml = useCallback(
    (vPositions: VehiclePosition[], zList: SpeedZone[], addMode: boolean) => {
      setHtml(generateVehicleMapHtml(vPositions, zList, addMode));
    },
    []
  );

  const fetchPositions = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const unitCode = await getStoredUnitCode();
      const tripsQuery = supabase
        .from('trips')
        .select('id, vehicle_id, start_place, end_place, vehicles!inner(vehicle_number, unit_code)')
        .eq('status', 'in_progress');
      if (unitCode) tripsQuery.eq('vehicles.unit_code', unitCode);
      const { data: trips, error: tripError } = await tripsQuery;

      if (tripError) throw tripError;

      if (!trips || trips.length === 0) {
        setVehicleCount(0);
        setPositions([]);
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

      const newPositions: VehiclePosition[] = [];
      for (const trip of trips) {
        const gps = latestByTrip.get(trip.id);
        if (!gps || gps.latitude == null || gps.longitude == null) continue;

        const veh = trip.vehicles as { vehicle_number?: string } | { vehicle_number?: string }[] | null;
        const vehicleNumber = Array.isArray(veh)
          ? (veh[0]?.vehicle_number ?? null)
          : (veh?.vehicle_number ?? null);

        newPositions.push({
          vehicleNumber: vehicleNumber ?? '미상',
          latitude: gps.latitude,
          longitude: gps.longitude,
          speedKmh: gps.speed_kmh,
          recordedAt: gps.recorded_at,
          startPlace: trip.start_place,
          endPlace: trip.end_place,
        });
      }

      setPositions(newPositions);
      setVehicleCount(newPositions.length);
      setLastUpdated(new Date());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '위치 조회 실패');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  // positions 또는 zones 또는 zoneAddMode 변경 시 HTML 재생성
  useEffect(() => {
    rebuildHtml(positions, zones, zoneAddMode);
  }, [positions, zones, zoneAddMode, rebuildHtml]);

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

  const handleMapTap = useCallback((lat: number, lng: number) => {
    if (!zoneAddMode) return;
    setPendingCoords({ lat, lng });
    setZoneName('');
    setZoneRadius('300');
    setZoneSpeedLimit('30');
    setZoneAddMode(false);
  }, [zoneAddMode]);

  const handleSaveZone = async () => {
    if (!pendingCoords) return;
    const name = zoneName.trim();
    if (!name) { Alert.alert('구역 이름을 입력하세요.'); return; }
    const radius = parseInt(zoneRadius, 10);
    const speedLimit = parseInt(zoneSpeedLimit, 10);
    if (!radius || radius < 50) { Alert.alert('반경은 50m 이상 입력하세요.'); return; }
    if (!speedLimit || speedLimit < 5) { Alert.alert('제한속도는 5km/h 이상 입력하세요.'); return; }

    setIsSavingZone(true);
    const unitCode = await getStoredUnitCode();
    const { error } = await addSpeedZone({
      unit_code: unitCode ?? '',
      name,
      center_lat: pendingCoords.lat,
      center_lng: pendingCoords.lng,
      radius_m: radius,
      speed_limit_kmh: speedLimit,
    });
    setIsSavingZone(false);

    if (error) {
      Alert.alert('저장 실패', error);
      return;
    }

    setPendingCoords(null);
    await loadZones();
  };

  const handleDeleteZone = (zone: SpeedZone) => {
    Alert.alert(
      '구역 삭제',
      `"${zone.name}" 구역을 삭제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            await deleteSpeedZone(zone.id);
            await loadZones();
          },
        },
      ]
    );
  };

  if (isCommander === null) {
    return (
      <View style={[styles.container, styles.centerBox, { paddingTop: insets.top }]}>
        <ActivityIndicator color="#2563EB" size="large" />
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
      {/* 헤더 */}
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
        <View style={styles.headerBtns}>
          <TouchableOpacity
            style={[styles.iconBtn, showZoneList && styles.iconBtnActive]}
            onPress={() => setShowZoneList((v) => !v)}>
            <Text style={[styles.iconBtnText, showZoneList && styles.iconBtnTextActive]}>
              구역 {zones.length}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, zoneAddMode && styles.iconBtnRed]}
            onPress={() => setZoneAddMode((v) => !v)}>
            <Text style={[styles.iconBtnText, zoneAddMode && styles.iconBtnRedText]}>
              {zoneAddMode ? '취소' : '+ 구역'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleRefresh}>
            <Text style={styles.iconBtnText}>새로고침</Text>
          </TouchableOpacity>
        </View>
      </View>

      {zoneAddMode && (
        <View style={styles.addModeBar}>
          <Text style={styles.addModeText}>지도를 탭하여 제한구역 중심을 선택하세요</Text>
        </View>
      )}

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
        <VehicleMap html={html} style={styles.map} onMapTap={handleMapTap} />
      )}

      {/* 차량 목록 */}
      {!isLoading && positions.length > 0 && !showZoneList && (
        <View style={styles.listPanel}>
          <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
            {positions.map((pos) => {
              const { text: ageText, stale } = getGpsAge(pos.recordedAt ?? null);
              const speed = pos.speedKmh != null ? Math.round(pos.speedKmh) : null;
              return (
                <View key={pos.vehicleNumber} style={styles.vehicleRow}>
                  <View style={styles.vehicleRowLeft}>
                    <Text style={styles.vehicleNum}>{pos.vehicleNumber}</Text>
                    <Text style={styles.vehicleRoute} numberOfLines={1}>
                      {pos.startPlace ?? ''} → {pos.endPlace ?? ''}
                    </Text>
                    <Text style={styles.vehicleGpsTime}>GPS {ageText}</Text>
                  </View>
                  <View style={styles.badges}>
                    {speed != null && (
                      <View style={[styles.badge, speed > 0 ? styles.badgeYellow : styles.badgeGray]}>
                        <Text style={speed > 0 ? styles.badgeYellowText : styles.badgeGrayText}>
                          {speed}km/h
                        </Text>
                      </View>
                    )}
                    <View style={[styles.badge, stale ? styles.badgeRed : styles.badgeGray]}>
                      <Text style={stale ? styles.badgeRedText : styles.badgeGrayText}>
                        {stale ? `경보·${ageText}` : '정상'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 구역 목록 */}
      {showZoneList && (
        <View style={styles.listPanel}>
          <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
            {zones.length === 0 ? (
              <View style={styles.zoneEmpty}>
                <Text style={styles.zoneEmptyText}>등록된 제한구역이 없습니다.</Text>
                <Text style={styles.zoneEmptyHint}>{'위 "+ 구역" 버튼을 눌러 지도에서 설정하세요.'}</Text>
              </View>
            ) : (
              zones.map((z) => (
                <View key={z.id} style={styles.zoneRow}>
                  <View style={styles.zoneLeft}>
                    <Text style={styles.zoneName}>{z.name}</Text>
                    <Text style={styles.zoneMeta}>제한 {z.speed_limit_kmh}km/h · 반경 {z.radius_m}m</Text>
                  </View>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteZone(z)}>
                    <Text style={styles.deleteBtnText}>삭제</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {/* 구역 추가 모달 */}
      <Modal
        visible={pendingCoords !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingCoords(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>제한구역 설정</Text>
            <Text style={styles.modalCoords}>
              위치: {pendingCoords?.lat.toFixed(5)}, {pendingCoords?.lng.toFixed(5)}
            </Text>

            <Text style={styles.inputLabel}>구역 이름</Text>
            <TextInput
              style={styles.textInput}
              value={zoneName}
              onChangeText={setZoneName}
              placeholder="예: 정문~위병소 구간"
              placeholderTextColor="#94A3B8"
            />

            <View style={styles.inputRow}>
              <View style={styles.inputHalf}>
                <Text style={styles.inputLabel}>반경 (m)</Text>
                <TextInput
                  style={styles.textInput}
                  value={zoneRadius}
                  onChangeText={setZoneRadius}
                  keyboardType="numeric"
                  placeholder="300"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <View style={styles.inputHalf}>
                <Text style={styles.inputLabel}>제한속도 (km/h)</Text>
                <TextInput
                  style={styles.textInput}
                  value={zoneSpeedLimit}
                  onChangeText={setZoneSpeedLimit}
                  keyboardType="numeric"
                  placeholder="30"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setPendingCoords(null)}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, isSavingZone && styles.saveBtnDisabled]}
                onPress={handleSaveZone}
                disabled={isSavingZone}>
                <Text style={styles.saveBtnText}>{isSavingZone ? '저장 중...' : '저장'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  accessTitle: { color: '#0F172A', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  accessDesc: { color: '#64748B', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  roleBtn: { backgroundColor: '#2563EB', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  roleBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  header: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: '#0F172A', fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#64748B', fontSize: 11, fontWeight: '500', marginTop: 2 },
  headerBtns: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  iconBtnActive: { backgroundColor: '#1D4ED8' },
  iconBtnRed: { backgroundColor: '#FEF2F2' },
  iconBtnText: { color: '#2563EB', fontSize: 12, fontWeight: '700' },
  iconBtnTextActive: { color: '#FFFFFF' },
  iconBtnRedText: { color: '#DC2626' },
  addModeBar: {
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addModeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  errorBox: { backgroundColor: '#FEF2F2', borderRadius: 10, margin: 12, padding: 12 },
  errorText: { color: '#B91C1C', fontSize: 13, fontWeight: '500' },
  loadingBox: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  loadingText: { color: '#64748B', fontSize: 14, fontWeight: '500' },
  map: { flex: 1 },
  listPanel: { backgroundColor: '#FFFFFF', borderTopColor: '#E2E8F0', borderTopWidth: 1, maxHeight: 220 },
  listScroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingVertical: 4 },
  vehicleRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: 8,
  },
  vehicleRowLeft: { flex: 1, minWidth: 0 },
  vehicleNum: { color: '#0F172A', fontSize: 15, fontWeight: '700' },
  vehicleRoute: { color: '#64748B', fontSize: 12, marginTop: 2 },
  vehicleGpsTime: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  badges: { alignItems: 'flex-end', gap: 4 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeGray: { backgroundColor: '#F1F5F9' },
  badgeGrayText: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  badgeYellow: { backgroundColor: '#FFFBEB' },
  badgeYellowText: { color: '#D97706', fontSize: 11, fontWeight: '600' },
  badgeRed: { backgroundColor: '#FEF2F2' },
  badgeRedText: { color: '#DC2626', fontSize: 11, fontWeight: '600' },
  zoneRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: 8,
  },
  zoneLeft: { flex: 1 },
  zoneName: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  zoneMeta: { color: '#DC2626', fontSize: 12, fontWeight: '500', marginTop: 2 },
  deleteBtn: { backgroundColor: '#FEF2F2', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  deleteBtnText: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  zoneEmpty: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  zoneEmptyText: { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  zoneEmptyHint: { color: '#64748B', fontSize: 12 },
  // 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  modalTitle: { color: '#0F172A', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalCoords: { color: '#64748B', fontSize: 12, marginBottom: 20 },
  inputLabel: { color: '#64748B', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 15,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputHalf: { flex: 1 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#64748B', fontSize: 15, fontWeight: '700' },
  saveBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
