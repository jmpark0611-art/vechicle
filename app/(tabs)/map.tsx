import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleMap } from '@/components/vehicle-map';
import { createSpeedZone, fetchLocationSnapshot, type LocationSnapshot, type ZonePoint } from '@/lib/location-data';
import { generateVehicleMapHtml } from '@/lib/map-html';

export default function MapScreen() {
  const [snapshot, setSnapshot] = useState<LocationSnapshot>({ positions: [], zones: [], alerts: [], message: '대기' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingZone, setIsSavingZone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneLimit, setZoneLimit] = useState('30');
  const [polygonPoints, setPolygonPoints] = useState<ZonePoint[]>([]);
  const polygonPointsRef = useRef<ZonePoint[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [mapDraftRevision, setMapDraftRevision] = useState(0);
  const alertedKeyRef = useRef<string | null>(null);

  const previewMapHtml = useMemo(
    () => generateVehicleMapHtml(snapshot.positions, snapshot.zones, false),
    [snapshot.positions, snapshot.zones]
  );

  const pickerDraft = useMemo(() => {
    void mapDraftRevision;
    return polygonPointsRef.current;
  }, [mapDraftRevision]);

  const pickerMapHtml = useMemo(
    () => generateVehicleMapHtml(snapshot.positions, snapshot.zones, true, pickerDraft, 'polygon'),
    [snapshot.positions, snapshot.zones, pickerDraft]
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

  useEffect(() => {
    const overspeed = snapshot.alerts.find((alert) => alert.status === 'overspeed');
    if (!overspeed) return;
    const key = `${overspeed.tripId}-${overspeed.zoneName}-${Math.round(overspeed.speedKmh ?? 0)}`;
    if (alertedKeyRef.current === key) return;
    alertedKeyRef.current = key;
    Vibration.vibrate([0, 450, 120, 450]);
    Alert.alert(
      '제한속도 초과',
      `${overspeed.vehicleNumber}\n${overspeed.zoneName}\n현재 ${Math.round(overspeed.speedKmh ?? 0)}km/h / 제한 ${Math.round(overspeed.speedLimitKmh)}km/h`
    );
  }, [snapshot.alerts]);

  function updatePolygonPoints(points: ZonePoint[]) {
    polygonPointsRef.current = points;
    setPolygonPoints(points);
  }

  function resetDraft() {
    updatePolygonPoints([]);
    setMapDraftRevision((current) => current + 1);
  }

  function undoPolygonPoint() {
    updatePolygonPoints(polygonPointsRef.current.slice(0, -1));
    setMapDraftRevision((current) => current + 1);
  }

  async function handleCreateZone() {
    const speedLimitKmh = Number(zoneLimit.trim());

    if (!zoneName.trim()) {
      Alert.alert('구역명 필요', '제한속도 구역 이름을 입력해 주세요.');
      return;
    }
    if (!Number.isFinite(speedLimitKmh) || speedLimitKmh <= 0) {
      Alert.alert('제한속도 확인', '제한속도는 0보다 큰 숫자로 입력해 주세요.');
      return;
    }
    if (polygonPoints.length < 3) {
      Alert.alert('면적 설정 필요', '큰 지도에서 꼭짓점을 3개 이상 찍어 구역 면적을 만들어 주세요.');
      return;
    }

    setIsSavingZone(true);
    try {
      const result = await createSpeedZone({
        name: zoneName,
        latitude: 0,
        longitude: 0,
        radiusM: 1,
        speedLimitKmh,
        zoneKind: 'polygon',
        polygonPoints,
      });
      Alert.alert(result.ok ? '구역 저장' : '구역 저장 실패', result.message);
      if (result.ok) {
        setZoneName('');
        resetDraft();
        setIsPickerOpen(false);
        await loadLocation();
      }
    } catch (error) {
      Alert.alert('구역 저장 실패', error instanceof Error ? error.message : '제한속도 구역을 저장하지 못했습니다.');
    } finally {
      setIsSavingZone(false);
    }
  }

  return (
    <RebuildScreen title="위치" actionLabel="새로고침" onAction={() => void loadLocation()}>
      {isLoading ? (
        <LoadingCard label="위치 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="위치 데이터 오류" body={errorMessage} />
      ) : (
        <>
          <VehicleMap html={previewMapHtml} style={styles.map} />

          <SectionCard title="속도구역 등록" body="큰 지도에서 경계점을 찍고 하단의 구역 저장 버튼을 누르세요.">
            <TextInput
              style={styles.input}
              value={zoneName}
              onChangeText={setZoneName}
              placeholder="예: 본부대 정문"
              placeholderTextColor="#94A3B8"
            />
            <TextInput
              style={styles.input}
              value={zoneLimit}
              onChangeText={setZoneLimit}
              placeholder="제한 km/h"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
            />
            <View style={styles.draftToolbar}>
              <Text style={styles.draftCount}>꼭짓점 {polygonPoints.length}개</Text>
              <Pressable style={styles.smallButton} onPress={undoPolygonPoint} disabled={polygonPoints.length === 0}>
                <Text style={styles.smallButtonText}>되돌리기</Text>
              </Pressable>
              <Pressable style={styles.smallButton} onPress={resetDraft}>
                <Text style={styles.smallButtonText}>초기화</Text>
              </Pressable>
            </View>
            <Pressable style={styles.mapPickBtn} onPress={() => setIsPickerOpen(true)}>
              <Text style={styles.mapPickBtnText}>큰 지도에서 구역 설정</Text>
            </Pressable>
          </SectionCard>

          <SectionCard title="제한속도 구역">
            {snapshot.zones.length === 0 ? (
              <StatusLine label="상태" value="등록 구역 없음" />
            ) : (
              snapshot.zones.map((zone) => (
                <View key={zone.id} style={styles.listItem}>
                  <Text style={styles.listTitle}>{zone.name}</Text>
                  <StatusLine label="방식" value={zone.zoneKind === 'polygon' ? `면적 ${zone.polygonPoints.length}점` : '기존 원형'} />
                  <StatusLine label="제한속도" value={`${Math.round(zone.speedLimitKmh)}km/h`} />
                </View>
              ))
            )}
          </SectionCard>

          <Modal visible={isPickerOpen} animationType="slide" onRequestClose={() => setIsPickerOpen(false)}>
            <View style={styles.modalRoot}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>구역 설정</Text>
                  <Text style={styles.modalSubtitle}>지도 탭으로 경계점 추가 · 꼭짓점 {polygonPoints.length}개</Text>
                </View>
                <Pressable style={styles.closeButton} onPress={() => setIsPickerOpen(false)}>
                  <Text style={styles.closeButtonText}>닫기</Text>
                </Pressable>
              </View>

              <VehicleMap html={pickerMapHtml} style={styles.fullMap} onPolygonChange={updatePolygonPoints} />

              <View style={styles.modalFooter}>
                <Pressable style={styles.footerButton} onPress={undoPolygonPoint} disabled={polygonPoints.length === 0}>
                  <Text style={styles.footerButtonText}>되돌리기</Text>
                </Pressable>
                <Pressable style={styles.footerButton} onPress={resetDraft}>
                  <Text style={styles.footerButtonText}>초기화</Text>
                </Pressable>
                <Pressable style={styles.footerPrimary} onPress={() => void handleCreateZone()} disabled={isSavingZone}>
                  <Text style={styles.footerPrimaryText}>{isSavingZone ? '저장 중' : '구역 저장'}</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, borderRadius: 8, marginBottom: 14 },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  draftToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
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
  mapPickBtn: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  mapPickBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  listItem: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14, marginTop: 14 },
  listTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  modalRoot: { flex: 1, backgroundColor: '#F8FAFC' },
  modalHeader: {
    minHeight: 86,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900' },
  modalSubtitle: { color: '#64748B', fontSize: 13, fontWeight: '800', marginTop: 4 },
  closeButton: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  closeButtonText: { color: '#2563EB', fontSize: 13, fontWeight: '900' },
  fullMap: { flex: 1, borderRadius: 0 },
  modalFooter: {
    minHeight: 78,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  footerButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonText: { color: '#334155', fontSize: 14, fontWeight: '900' },
  footerPrimary: {
    flex: 1.3,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrimaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
