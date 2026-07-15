import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleMap } from '@/components/vehicle-map';
import { createSpeedZone, fetchLocationSnapshot, type LocationSnapshot, type ZonePoint } from '@/lib/location-data';
import { generateVehicleMapHtml } from '@/lib/map-html';

type ZoneDraftMode = 'circle' | 'polygon';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatCoord(value: number) {
  return value.toFixed(5);
}

export default function MapScreen() {
  const [snapshot, setSnapshot] = useState<LocationSnapshot>({ positions: [], zones: [], alerts: [], message: '대기' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingZone, setIsSavingZone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneLat, setZoneLat] = useState('');
  const [zoneLng, setZoneLng] = useState('');
  const [zoneRadius, setZoneRadius] = useState('100');
  const [zoneLimit, setZoneLimit] = useState('30');
  const [zoneAddMode, setZoneAddMode] = useState(false);
  const [zoneDraftMode, setZoneDraftMode] = useState<ZoneDraftMode>('polygon');
  const [polygonPoints, setPolygonPoints] = useState<ZonePoint[]>([]);

  const mapHtml = useMemo(
    () => generateVehicleMapHtml(snapshot.positions, snapshot.zones, zoneAddMode, polygonPoints),
    [snapshot.positions, snapshot.zones, zoneAddMode, polygonPoints]
  );

  const loadLocation = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setSnapshot(await fetchLocationSnapshot());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '위치 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocation();
  }, [loadLocation]);

  function applyMapPoint(lat: number, lng: number) {
    if (zoneDraftMode === 'polygon') {
      setPolygonPoints((current) => [...current, { latitude: lat, longitude: lng }]);
      return;
    }
    setZoneLat(lat.toFixed(6));
    setZoneLng(lng.toFixed(6));
  }

  function applyCenterPoint(lat: number, lng: number) {
    setZoneLat(lat.toFixed(6));
    setZoneLng(lng.toFixed(6));
  }

  function resetDraft() {
    setZoneLat('');
    setZoneLng('');
    setPolygonPoints([]);
  }

  async function handleCreateZone() {
    const latitude = Number(zoneLat.trim());
    const longitude = Number(zoneLng.trim());
    const radiusM = Number(zoneRadius.trim());
    const speedLimitKmh = Number(zoneLimit.trim());

    if (!zoneName.trim()) {
      Alert.alert('구역명 필요', '제한속도 구역 이름을 입력해 주세요.');
      return;
    }
    if (!Number.isFinite(speedLimitKmh) || speedLimitKmh <= 0) {
      Alert.alert('제한속도 확인', '제한속도는 0보다 큰 숫자로 입력해 주세요.');
      return;
    }

    if (zoneDraftMode === 'polygon') {
      if (polygonPoints.length < 3) {
        Alert.alert('면적 설정 필요', '지도에서 꼭짓점을 3개 이상 찍어 구역 면적을 만들어 주세요.');
        return;
      }
    } else {
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        Alert.alert('위도 확인', '위도는 -90부터 90 사이 숫자로 입력해 주세요.');
        return;
      }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        Alert.alert('경도 확인', '경도는 -180부터 180 사이 숫자로 입력해 주세요.');
        return;
      }
      if (!Number.isFinite(radiusM) || radiusM <= 0) {
        Alert.alert('반경 확인', '반경은 0보다 큰 숫자로 입력해 주세요.');
        return;
      }
    }

    setIsSavingZone(true);
    try {
      const result = await createSpeedZone({
        name: zoneName,
        latitude: Number.isFinite(latitude) ? latitude : 0,
        longitude: Number.isFinite(longitude) ? longitude : 0,
        radiusM: Number.isFinite(radiusM) ? radiusM : 1,
        speedLimitKmh,
        zoneKind: zoneDraftMode,
        polygonPoints,
      });
      Alert.alert(result.ok ? '구역 저장' : '구역 저장 실패', result.message);
      if (result.ok) {
        setZoneName('');
        resetDraft();
        await loadLocation();
      }
    } catch (error) {
      Alert.alert('구역 저장 실패', error instanceof Error ? error.message : '제한속도 구역을 저장하지 못했습니다.');
    } finally {
      setIsSavingZone(false);
    }
  }

  return (
    <RebuildScreen
      title="실시간 위치"
      metrics={[
        { label: '운행 차량', value: `${snapshot.positions.length}대` },
        { label: '제한구역', value: `${snapshot.zones.length}곳` },
      ]}
      actionLabel="새로고침"
      onAction={() => void loadLocation()}>
      {isLoading ? (
        <LoadingCard label="위치 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="위치 데이터 오류" body={errorMessage} />
      ) : (
        <>
          <VehicleMap
            html={mapHtml}
            style={styles.map}
            onMapTap={zoneAddMode ? applyMapPoint : undefined}
            onMapCenter={zoneAddMode ? applyCenterPoint : undefined}
          />

          <SectionCard
            title="속도구역 등록"
            body={zoneDraftMode === 'polygon'
              ? '지도에서 구역 경계를 따라 꼭짓점을 찍어 면적으로 저장합니다.'
              : '지도 중심 좌표와 반경으로 원형 구역을 저장합니다.'}>
            <View style={styles.segment}>
              <Pressable
                style={[styles.segmentButton, zoneDraftMode === 'polygon' && styles.segmentButtonActive]}
                onPress={() => {
                  setZoneDraftMode('polygon');
                  setZoneAddMode(true);
                }}>
                <Text style={[styles.segmentText, zoneDraftMode === 'polygon' && styles.segmentTextActive]}>면적</Text>
              </Pressable>
              <Pressable
                style={[styles.segmentButton, zoneDraftMode === 'circle' && styles.segmentButtonActive]}
                onPress={() => {
                  setZoneDraftMode('circle');
                  setZoneAddMode(true);
                  setPolygonPoints([]);
                }}>
                <Text style={[styles.segmentText, zoneDraftMode === 'circle' && styles.segmentTextActive]}>원형</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.input}
              value={zoneName}
              onChangeText={setZoneName}
              placeholder="예: 본부대 정문"
              placeholderTextColor="#94A3B8"
            />

            <Pressable
              style={[styles.mapPickBtn, zoneAddMode && styles.mapPickBtnActive]}
              onPress={() => setZoneAddMode((current) => !current)}>
              <Text style={styles.mapPickBtnText}>{zoneAddMode ? '지도 선택 중지' : '지도에서 구역 선택'}</Text>
            </Pressable>

            {zoneDraftMode === 'polygon' ? (
              <>
                <View style={styles.draftToolbar}>
                  <Text style={styles.draftCount}>꼭짓점 {polygonPoints.length}개</Text>
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => setPolygonPoints((current) => current.slice(0, -1))}
                    disabled={polygonPoints.length === 0}>
                    <Text style={styles.smallButtonText}>되돌리기</Text>
                  </Pressable>
                  <Pressable style={styles.smallButton} onPress={() => setPolygonPoints([])}>
                    <Text style={styles.smallButtonText}>초기화</Text>
                  </Pressable>
                </View>
                <Text style={styles.helpText}>3개 이상 찍으면 저장할 수 있습니다. 마지막 점은 자동으로 처음 점과 연결됩니다.</Text>
              </>
            ) : (
              <>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.inputHalf}
                    value={zoneLat}
                    onChangeText={setZoneLat}
                    placeholder="위도"
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={styles.inputHalf}
                    value={zoneLng}
                    onChangeText={setZoneLng}
                    placeholder="경도"
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                  />
                </View>
                <TextInput
                  style={styles.input}
                  value={zoneRadius}
                  onChangeText={setZoneRadius}
                  placeholder="반경 m"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                />
              </>
            )}

            <TextInput
              style={styles.input}
              value={zoneLimit}
              onChangeText={setZoneLimit}
              placeholder="제한 km/h"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
            />

            <Pressable style={styles.saveZoneBtn} onPress={() => void handleCreateZone()} disabled={isSavingZone}>
              <Text style={styles.saveZoneBtnText}>{isSavingZone ? '저장 중' : '구역 저장'}</Text>
            </Pressable>
          </SectionCard>

          <SectionCard title="제한속도 경고">
            {snapshot.alerts.length === 0 ? (
              <StatusLine label="상태" value="감지된 차량 없음" />
            ) : (
              snapshot.alerts.map((alert) => (
                <View key={`${alert.tripId}-${alert.zoneName}`} style={styles.listItem}>
                  <View style={styles.alertHeader}>
                    <Text style={styles.listTitle}>{alert.vehicleNumber}</Text>
                    <Text style={[styles.alertBadge, alert.status === 'overspeed' && styles.alertBadgeDanger]}>
                      {alert.status === 'overspeed' ? '초과 위험' : '구역 안'}
                    </Text>
                  </View>
                  <Text style={styles.listBody}>{alert.zoneName}</Text>
                  <StatusLine label="중심거리" value={`${Math.round(alert.distanceM)}m`} />
                  <StatusLine
                    label="속도"
                    value={`${alert.speedKmh === null ? '-' : `${Math.round(alert.speedKmh)}km/h`} / 제한 ${Math.round(alert.speedLimitKmh)}km/h`}
                  />
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="운행 중 차량">
            {snapshot.positions.length === 0 ? (
              <StatusLine label="상태" value="최근 GPS 없음" />
            ) : (
              snapshot.positions.map((position) => (
                <View key={position.tripId} style={styles.listItem}>
                  <Text style={styles.listTitle}>{position.vehicleNumber}</Text>
                  <Text style={styles.listBody}>{position.route}</Text>
                  <StatusLine label="마지막 GPS" value={formatTime(position.recordedAt)} />
                  <StatusLine label="좌표" value={`${formatCoord(position.latitude)}, ${formatCoord(position.longitude)}`} />
                  <StatusLine label="속도" value={position.speedKmh === null ? '-' : `${Math.round(position.speedKmh)}km/h`} />
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="제한속도 구역">
            {snapshot.zones.length === 0 ? (
              <StatusLine label="상태" value="등록 구역 없음" />
            ) : (
              snapshot.zones.map((zone) => (
                <View key={zone.id} style={styles.listItem}>
                  <Text style={styles.listTitle}>{zone.name}</Text>
                  <StatusLine label="방식" value={zone.zoneKind === 'polygon' ? `면적 ${zone.polygonPoints.length}점` : '원형'} />
                  <StatusLine label="제한속도" value={`${Math.round(zone.speedLimitKmh)}km/h`} />
                  {zone.zoneKind === 'circle' ? <StatusLine label="반경" value={`${Math.round(zone.radiusM)}m`} /> : null}
                </View>
              ))
            )}
          </SectionCard>
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 380,
    borderRadius: 8,
    marginBottom: 14,
  },
  listItem: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 14,
    marginTop: 14,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  alertBadge: {
    color: '#0F766E',
    backgroundColor: '#ECFDF5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
  },
  alertBadgeDanger: {
    color: '#B91C1C',
    backgroundColor: '#FEF2F2',
  },
  listTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  listBody: { color: '#64748B', fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 4 },
  segment: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    padding: 4,
    marginTop: 12,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  segmentText: { color: '#64748B', fontSize: 14, fontWeight: '900' },
  segmentTextActive: { color: '#2563EB' },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
    marginTop: 12,
  },
  inputRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  inputHalf: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
  mapPickBtn: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  mapPickBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#1D4ED8',
  },
  mapPickBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  draftToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  draftCount: { flex: 1, color: '#0F172A', fontSize: 14, fontWeight: '900' },
  smallButton: {
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonText: { color: '#334155', fontSize: 12, fontWeight: '900' },
  helpText: { color: '#64748B', fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 8 },
  saveZoneBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  saveZoneBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
