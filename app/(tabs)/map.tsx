import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import { VehicleMap } from '@/components/vehicle-map';
import { useRoleGuard } from '@/hooks/use-role-guard';
import { createSpeedZone, deleteSpeedZone, fetchLocationSnapshot, type LocationSnapshot, type ZonePoint } from '@/lib/location-data';
import { generateVehicleMapHtml } from '@/lib/map-html';
import { overspeedWarningKey, showOverspeedWarning } from '@/lib/overspeed-warning';

const SPEED_REFRESH_MS = 10_000;

export default function MapScreen() {
  useRoleGuard(['commander', 'admin']);

  const insets = useSafeAreaInsets();
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

  const loadLocation = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    setErrorMessage(null);
    try {
      setSnapshot(await fetchLocationSnapshot());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '위치 데이터를 불러오지 못했습니다.');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadLocation();
  }, [loadLocation]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadLocation(false);
    }, SPEED_REFRESH_MS);

    return () => clearInterval(timer);
  }, [loadLocation]);

  useEffect(() => {
    const overspeed = snapshot.alerts.find((alert) => alert.status === 'overspeed');
    if (!overspeed) {
      alertedKeyRef.current = null;
      return;
    }
    const key = overspeedWarningKey(overspeed);
    if (alertedKeyRef.current === key) return;
    alertedKeyRef.current = key;
    showOverspeedWarning(overspeed);
  }, [snapshot.alerts]);

  function updatePolygonPoints(points: ZonePoint[]) {
    polygonPointsRef.current = points;
    setPolygonPoints(points);
  }

  function resetDraft() {
    updatePolygonPoints([]);
    setMapDraftRevision((current) => current + 1);
  }

  async function handleDeleteZone(id: string, name: string) {
    Alert.alert('구역 삭제', `"${name}" 구역을 삭제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteSpeedZone(id);
          if (result.ok) {
            await loadLocation();
          } else {
            Alert.alert('삭제 실패', result.message);
          }
        },
      },
    ]);
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
    <RebuildScreen title="속도" bottomSpace="compact">
      {isLoading ? (
        <LoadingCard label="위치 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="위치 데이터 오류" body={errorMessage} />
      ) : (
        <>
          <VehicleMap html={previewMapHtml} style={styles.map} />

          <SectionCard title="속도구역 등록">
            <Text style={styles.formGuide}>구역명과 제한속도를 먼저 입력하고 → <Text style={styles.formGuideAccent}>구역 설정</Text>에서 지도 경계점을 찍으세요</Text>
            <View style={styles.zoneInputRow}>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>구역명</Text>
                <TextInput
                  style={styles.input}
                  value={zoneName}
                  onChangeText={setZoneName}
                  placeholder="예) 정문 앞 도로"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <View style={styles.inputWrapSmall}>
                <Text style={styles.inputLabel}>제한속도</Text>
                <TextInput
                  style={styles.input}
                  value={zoneLimit}
                  onChangeText={setZoneLimit}
                  placeholder="km/h"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <View style={styles.draftToolbar}>
              <Text style={styles.draftCount}>꼭짓점 {polygonPoints.length}개</Text>
              <Pressable style={styles.smallButton} onPress={resetDraft}>
                <Text style={styles.smallButtonText}>초기화</Text>
              </Pressable>
            </View>
            <Pressable style={styles.mapPickBtn} onPress={() => setIsPickerOpen(true)}>
              <Text style={styles.mapPickBtnText}>구역 설정</Text>
            </Pressable>
          </SectionCard>

          <SectionCard title={`제한속도 구역 (${snapshot.zones.length}개)`}>
            {snapshot.zones.length === 0 ? (
              <StatusLine label="상태" value="등록 구역 없음" />
            ) : (
              snapshot.zones.map((zone) => (
                <View key={zone.id} style={styles.listItem}>
                  <View style={styles.listHeader}>
                    <Text style={styles.listTitle}>{zone.name}</Text>
                    <Pressable style={styles.deleteBtn} onPress={() => void handleDeleteZone(zone.id, zone.name)}>
                      <Text style={styles.deleteBtnText}>삭제</Text>
                    </Pressable>
                  </View>
                  <View style={styles.listMeta}>
                    <Text style={styles.listMetaText}>{zone.zoneKind === 'polygon' ? `면적 ${zone.polygonPoints.length}점` : '원형'}</Text>
                    <Text style={styles.listSpeed}>{Math.round(zone.speedLimitKmh)} km/h</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          <Modal visible={isPickerOpen} animationType="slide" onRequestClose={() => setIsPickerOpen(false)}>
            <View style={styles.modalRoot}>
              <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
                <View>
                  <Text style={styles.modalTitle}>구역 설정</Text>
                  <Text style={styles.modalSubtitle}>지도 탭으로 경계점 추가 · 꼭짓점 {polygonPoints.length}개</Text>
                </View>
                <Pressable style={styles.closeButton} onPress={() => setIsPickerOpen(false)}>
                  <Text style={styles.closeButtonText}>닫기</Text>
                </Pressable>
              </View>

              <VehicleMap key={mapDraftRevision} html={pickerMapHtml} style={styles.fullMap} onPolygonChange={updatePolygonPoints} />

              <View style={styles.modalFooter}>
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
  map: { height: 196, borderRadius: 14, marginBottom: 10 },
  formGuide: { fontSize: 13, color: '#475569', fontWeight: '600', marginBottom: 10, lineHeight: 20 },
  formGuideAccent: { color: '#2563EB', fontWeight: '800' },
  zoneInputRow: { flexDirection: 'row', gap: 10 },
  inputWrap: { flex: 1.6 },
  inputWrapSmall: { flex: 1 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 5 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DCEAF8',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
  draftToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  draftCount: { flex: 1, color: '#0F172A', fontSize: 14, fontWeight: '900' },
  smallButton: {
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonText: { color: '#334155', fontSize: 12, fontWeight: '900' },
  mapPickBtn: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  mapPickBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '900' },
  listItem: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10, marginTop: 10 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  listTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900', flex: 1, marginRight: 8 },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  deleteBtnText: { color: '#DC2626', fontSize: 12, fontWeight: '800' },
  listMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listMetaText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  listSpeed: { color: '#2563EB', fontSize: 13, fontWeight: '800' },
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
