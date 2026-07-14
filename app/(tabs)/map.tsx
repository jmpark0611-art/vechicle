import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import {
  createSpeedZone,
  fetchLocationSnapshot,
  type LocationSnapshot,
  type SpeedZone,
  type VehiclePosition,
} from '@/lib/location-data';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatCoord(value: number) {
  return value.toFixed(5);
}

function getBounds(items: (VehiclePosition | SpeedZone)[]) {
  if (items.length === 0) {
    return null;
  }
  const latitudes = items.map((item) => item.latitude);
  const longitudes = items.map((item) => item.longitude);
  return {
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
    minLng: Math.min(...longitudes),
    maxLng: Math.max(...longitudes),
  };
}

function markerPercent(value: number, min: number, max: number, inverted = false): `${number}%` {
  if (min === max) {
    return '50%';
  }
  const ratio = (value - min) / (max - min);
  const padded = 12 + ratio * 76;
  return `${inverted ? 100 - padded : padded}%` as `${number}%`;
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

  const bounds = useMemo(
    () => getBounds([...snapshot.positions, ...snapshot.zones]),
    [snapshot.positions, snapshot.zones]
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

  async function handleCreateZone() {
    const latitude = Number(zoneLat.trim());
    const longitude = Number(zoneLng.trim());
    const radiusM = Number(zoneRadius.trim());
    const speedLimitKmh = Number(zoneLimit.trim());

    if (!zoneName.trim()) {
      Alert.alert('구역명 필요', '제한속도 구역 이름을 입력해 주세요.');
      return;
    }
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
    if (!Number.isFinite(speedLimitKmh) || speedLimitKmh <= 0) {
      Alert.alert('제한속도 확인', '제한속도는 0보다 큰 숫자로 입력해 주세요.');
      return;
    }

    setIsSavingZone(true);
    try {
      const result = await createSpeedZone({
        name: zoneName,
        latitude,
        longitude,
        radiusM,
        speedLimitKmh,
      });
      Alert.alert(result.ok ? '구역 저장' : '구역 저장 실패', result.message);
      if (result.ok) {
        setZoneName('');
        setZoneLat('');
        setZoneLng('');
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
      subtitle="진행 중 운행의 최근 GPS 포인트와 수송부 제한속도 구역을 안전한 읽기 전용 화면으로 표시합니다."
      metrics={[
        { label: '운행 차량', value: `${snapshot.positions.length}대` },
        { label: '제한구역', value: `${snapshot.zones.length}곳` },
        { label: '구역 경고', value: `${snapshot.alerts.length}건` },
        { label: '동기화', value: errorMessage ? '오류' : '대기' },
      ]}
      actionLabel="위치 새로고침"
      onAction={() => void loadLocation()}>
      <SectionCard title="위치 동기화" body="GPS 권한과 WebView 지도는 아직 붙이지 않고, Supabase에 저장된 최근 위치만 먼저 읽습니다.">
        <StatusLine label="상태" value={errorMessage ?? snapshot.message} />
      </SectionCard>

      {isLoading ? (
        <LoadingCard label="위치 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="위치 데이터 오류" body={errorMessage} />
      ) : (
        <>
          <View style={styles.mapPanel}>
            <View style={styles.gridLineVertical} />
            <View style={styles.gridLineHorizontal} />
            {bounds && snapshot.zones.map((zone) => (
              <View
                key={zone.id}
                style={[
                  styles.zoneMarker,
                  {
                    left: markerPercent(zone.longitude, bounds.minLng, bounds.maxLng),
                    top: markerPercent(zone.latitude, bounds.minLat, bounds.maxLat, true),
                  },
                ]}>
                <Text style={styles.zoneMarkerText}>{Math.round(zone.speedLimitKmh)}</Text>
              </View>
            ))}
            {bounds && snapshot.positions.map((position) => (
              <View
                key={position.tripId}
                style={[
                  styles.vehicleMarker,
                  {
                    left: markerPercent(position.longitude, bounds.minLng, bounds.maxLng),
                    top: markerPercent(position.latitude, bounds.minLat, bounds.maxLat, true),
                  },
                ]}>
                <Text style={styles.vehicleMarkerText}>{position.vehicleNumber}</Text>
              </View>
            ))}
            {!bounds ? (
              <View style={styles.emptyMap}>
                <Text style={styles.emptyMapTitle}>표시할 위치 없음</Text>
                <Text style={styles.emptyMapBody}>진행 중 운행의 GPS 포인트가 쌓이면 이곳에 표시됩니다.</Text>
              </View>
            ) : null}
          </View>

          <SectionCard title="제한속도 경고" body="최근 GPS가 제한속도 구역 반경 안에 들어온 차량을 표시합니다. 속도값이 제한보다 높으면 초과 의심으로 표시합니다.">
            {snapshot.alerts.length === 0 ? (
              <StatusLine label="상태" value="감지된 차량 없음" />
            ) : (
              snapshot.alerts.map((alert) => (
                <View key={`${alert.tripId}-${alert.zoneName}`} style={styles.listItem}>
                  <View style={styles.alertHeader}>
                    <Text style={styles.listTitle}>{alert.vehicleNumber}</Text>
                    <Text style={[styles.alertBadge, alert.status === 'overspeed' && styles.alertBadgeDanger]}>
                      {alert.status === 'overspeed' ? '초과 의심' : '구역 안'}
                    </Text>
                  </View>
                  <Text style={styles.listBody}>{alert.zoneName}</Text>
                  <StatusLine label="거리" value={`${Math.round(alert.distanceM)}m`} />
                  <StatusLine
                    label="속도"
                    value={`${alert.speedKmh === null ? '-' : `${Math.round(alert.speedKmh)}km/h`} / 제한 ${Math.round(alert.speedLimitKmh)}km/h`}
                  />
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="운행 중 차량" body="각 차량의 마지막 GPS 저장 시각과 좌표를 표시합니다.">
            {snapshot.positions.length === 0 ? (
              <StatusLine label="상태" value="최근 GPS 없음" />
            ) : (
              snapshot.positions.map((position) => (
                <View key={position.tripId} style={styles.listItem}>
                  <Text style={styles.listTitle}>{position.vehicleNumber}</Text>
                  <Text style={styles.listBody}>{position.route}</Text>
                  <StatusLine label="마지막 GPS" value={formatTime(position.recordedAt)} />
                  <StatusLine
                    label="좌표"
                    value={`${formatCoord(position.latitude)}, ${formatCoord(position.longitude)}`}
                  />
                  <StatusLine
                    label="속도"
                    value={position.speedKmh === null ? '-' : `${Math.round(position.speedKmh)}km/h`}
                  />
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="제한속도 구역" body="수송부에서 지정한 구역을 읽기 전용으로 표시합니다.">
            {snapshot.zones.length === 0 ? (
              <StatusLine label="상태" value="등록 구역 없음" />
            ) : (
              snapshot.zones.map((zone) => (
                <View key={zone.id} style={styles.listItem}>
                  <Text style={styles.listTitle}>{zone.name}</Text>
                  <StatusLine label="제한속도" value={`${Math.round(zone.speedLimitKmh)}km/h`} />
                  <StatusLine label="반경" value={`${Math.round(zone.radiusM)}m`} />
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="제한속도 구역 등록" body="수송부 모드에서 사용할 제한속도 구역을 좌표 기준으로 등록합니다.">
            <TextInput
              style={styles.input}
              value={zoneName}
              onChangeText={setZoneName}
              placeholder="예: 본부대 정문"
              placeholderTextColor="#94A3B8"
            />
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
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputHalf}
                value={zoneRadius}
                onChangeText={setZoneRadius}
                placeholder="반경 m"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.inputHalf}
                value={zoneLimit}
                onChangeText={setZoneLimit}
                placeholder="제한 km/h"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
              />
            </View>
            <Pressable style={styles.saveZoneBtn} onPress={() => void handleCreateZone()} disabled={isSavingZone}>
              <Text style={styles.saveZoneBtnText}>{isSavingZone ? '저장 중' : '구역 저장'}</Text>
            </Pressable>
          </SectionCard>
        </>
      )}

      <SectionCard
        title="다음 단계"
        body="이 읽기 전용 위치판이 APK에서 안정적으로 동작하면 GPS 권한/저장, 구역 등록 UI, WebView 지도 순서로 복구합니다."
      />
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  mapPanel: {
    height: 280,
    borderRadius: 22,
    backgroundColor: '#EAF2FF',
    borderWidth: 1,
    borderColor: '#D8E3F0',
    marginBottom: 14,
    overflow: 'hidden',
  },
  gridLineVertical: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  vehicleMarker: {
    position: 'absolute',
    transform: [{ translateX: -34 }, { translateY: -16 }],
    minWidth: 68,
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  vehicleMarkerText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  zoneMarker: {
    position: 'absolute',
    transform: [{ translateX: -15 }, { translateY: -15 }],
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  zoneMarkerText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  emptyMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  emptyMapTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  emptyMapBody: { color: '#64748B', fontSize: 13, fontWeight: '700', lineHeight: 20, textAlign: 'center' },
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
  input: {
    minHeight: 52,
    borderRadius: 14,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
  saveZoneBtn: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  saveZoneBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
