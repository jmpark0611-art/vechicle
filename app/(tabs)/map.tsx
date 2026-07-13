import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { fetchLocationSnapshot, type LocationSnapshot, type SpeedZone, type VehiclePosition } from '@/lib/location-data';

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
  const [snapshot, setSnapshot] = useState<LocationSnapshot>({ positions: [], zones: [], message: '대기' });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <RebuildScreen
      title="실시간 위치"
      subtitle="진행 중 운행의 최근 GPS 포인트와 수송부 제한속도 구역을 안전한 읽기 전용 화면으로 표시합니다."
      metrics={[
        { label: '운행 차량', value: `${snapshot.positions.length}대` },
        { label: '제한구역', value: `${snapshot.zones.length}곳` },
        { label: '지도', value: '읽기' },
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
  listTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  listBody: { color: '#64748B', fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 4 },
});
