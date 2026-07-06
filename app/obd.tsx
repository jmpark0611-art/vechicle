import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { obdBle, ObdConnectionState, ObdDevice, ObdLiveData } from '../lib/obd-ble';
import { supabase } from '../lib/supabase';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function ObdScreen() {
  const insets = useSafeAreaInsets();
  const { vehicleId, tripId } = useLocalSearchParams<{ vehicleId?: string; tripId?: string }>();

  const [bleState, setBleState] = useState<ObdConnectionState>('idle');
  const [bleMessage, setBleMessage] = useState('');
  const [devices, setDevices] = useState<ObdDevice[]>([]);
  const [liveData, setLiveData] = useState<ObdLiveData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [dtcLoading, setDtcLoading] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    obdBle.setCallbacks({
      onStateChange: (state, message) => {
        setBleState(state);
        if (message) setBleMessage(message);
      },
      onDeviceFound: (device) => {
        setDevices((prev) => {
          if (prev.some((d) => d.id === device.id)) return prev;
          return [...prev, device].sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100));
        });
      },
      onData: (data) => setLiveData(data),
    });

    return () => {
      obdBle.disconnect();
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    };
  }, []);

  // 연결 시 30초마다 Supabase에 자동 저장
  useEffect(() => {
    if (bleState === 'connected' && vehicleId) {
      saveTimerRef.current = setInterval(() => {
        saveToDb();
      }, 30_000);
    } else {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleState, vehicleId]);

  const handleScan = useCallback(async () => {
    setDevices([]);
    setBleMessage('');
    const on = await obdBle.checkBluetoothState();
    if (!on) {
      setBleState('error');
      setBleMessage('블루투스가 꺼져 있습니다. 설정에서 켜주세요.');
      return;
    }
    obdBle.startScan();
    setTimeout(() => {
      obdBle.stopScan();
      setBleState((prev) => (prev === 'scanning' ? 'idle' : prev));
    }, 10_000);
  }, []);

  const handleConnect = useCallback(async (deviceId: string) => {
    setBleMessage('');
    try {
      await obdBle.connect(deviceId);
    } catch (e) {
      setBleState('error');
      setBleMessage(e instanceof Error ? e.message : '연결 실패');
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    await obdBle.disconnect();
    setLiveData(null);
    setSaveState('idle');
  }, []);

  const handleReadDtc = useCallback(async () => {
    setDtcLoading(true);
    await obdBle.readDtcCodes();
    setDtcLoading(false);
  }, []);

  const saveToDb = useCallback(async () => {
    if (!liveData || !vehicleId) return;
    setSaveState('saving');
    const { error } = await supabase.from('obd_logs').insert({
      vehicle_id: vehicleId,
      trip_id: tripId ?? null,
      speed_kmh: liveData.speedKmh,
      rpm: liveData.rpm,
      coolant_temp_c: liveData.coolantTempC,
      battery_voltage: liveData.batteryVoltage,
      fuel_level_percent: liveData.fuelLevelPercent,
      engine_load_percent: liveData.engineLoadPercent,
      throttle_percent: liveData.throttlePercent,
      intake_air_temp_c: liveData.intakeAirTempC,
      ignition_status: liveData.ignitionOn ? 'on' : 'off',
      dtc_codes: liveData.dtcCodes,
      recorded_at: liveData.recordedAt,
    });
    setSaveState(error ? 'error' : 'saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }, [liveData, vehicleId, tripId]);

  const isConnected = bleState === 'connected';
  const isWorking = bleState === 'scanning' || bleState === 'connecting' || bleState === 'initializing';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>OBD 단말기</Text>
          <Text style={styles.subtitle}>Vgate iCar Pro BLE</Text>
        </View>
        <View style={styles.statusDot}>
          <View style={[styles.dot, isConnected ? styles.dotGreen : styles.dotGray]} />
          <Text style={[styles.dotLabel, isConnected ? styles.dotLabelGreen : styles.dotLabelGray]}>
            {isConnected ? '연결됨' : '미연결'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 96, 112) },
        ]}
        showsVerticalScrollIndicator={false}>

        {/* 상태 메시지 */}
        {bleMessage ? (
          <View style={[styles.msgBox, bleState === 'error' ? styles.msgError : styles.msgInfo]}>
            <Text style={[styles.msgText, bleState === 'error' ? styles.msgErrorText : styles.msgInfoText]}>
              {bleMessage}
            </Text>
          </View>
        ) : null}

        {/* 연결 전: 스캔 UI */}
        {!isConnected && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>블루투스 장치 검색</Text>
            </View>

            <TouchableOpacity
              style={[styles.scanBtn, isWorking && styles.scanBtnDisabled]}
              onPress={handleScan}
              disabled={isWorking}>
              {isWorking ? (
                <ActivityIndicator color="#F59E0B" size="small" />
              ) : null}
              <Text style={styles.scanBtnText}>
                {bleState === 'scanning'
                  ? '검색 중...'
                  : bleState === 'connecting'
                    ? '연결 중...'
                    : bleState === 'initializing'
                      ? '초기화 중...'
                      : '장치 검색 시작'}
              </Text>
            </TouchableOpacity>

            {Platform.OS !== 'android' && Platform.OS !== 'ios' && (
              <View style={styles.webNotice}>
                <Text style={styles.webNoticeText}>
                  BLE 기능은 Android/iOS 앱에서만 동작합니다.{'\n'}EAS 빌드 후 실기기에서 테스트하세요.
                </Text>
              </View>
            )}

            {devices.length > 0 && (
              <FlatList
                data={devices}
                keyExtractor={(d) => d.id}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.deviceRow}
                    onPress={() => handleConnect(item.id)}
                    disabled={isWorking}>
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>{item.name}</Text>
                      <Text style={styles.deviceId}>{item.id.slice(0, 8)}…</Text>
                    </View>
                    <View style={styles.deviceRight}>
                      {item.rssi != null && (
                        <Text style={styles.rssi}>{item.rssi} dBm</Text>
                      )}
                      <Text style={styles.connectLabel}>연결</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}

            {devices.length === 0 && bleState === 'idle' && (
              <Text style={styles.emptyHint}>
                검색 버튼을 눌러 OBD 어댑터를 찾으세요.{'\n'}
                단말기 전원이 켜져 있어야 합니다.
              </Text>
            )}
          </View>
        )}

        {/* 연결 후: 라이브 데이터 */}
        {isConnected && (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>실시간 차량 데이터</Text>
                {saveState === 'saving' && <ActivityIndicator color="#F59E0B" size="small" />}
                {saveState === 'saved' && <Text style={styles.savedLabel}>저장됨</Text>}
                {saveState === 'error' && <Text style={styles.errorLabel}>저장 실패</Text>}
              </View>

              <View style={styles.dataGrid}>
                <DataTile
                  label="차속"
                  value={liveData?.speedKmh != null ? `${liveData.speedKmh}` : '-'}
                  unit="km/h"
                  highlight={liveData?.speedKmh != null && liveData.speedKmh > 100}
                />
                <DataTile
                  label="RPM"
                  value={liveData?.rpm != null ? `${liveData.rpm.toLocaleString()}` : '-'}
                  unit="rpm"
                  highlight={liveData?.rpm != null && liveData.rpm > 4000}
                />
                <DataTile
                  label="냉각수"
                  value={liveData?.coolantTempC != null ? `${liveData.coolantTempC}` : '-'}
                  unit="°C"
                  highlight={liveData?.coolantTempC != null && liveData.coolantTempC > 100}
                />
                <DataTile
                  label="배터리"
                  value={liveData?.batteryVoltage != null ? `${liveData.batteryVoltage.toFixed(1)}` : '-'}
                  unit="V"
                  highlight={liveData?.batteryVoltage != null && liveData.batteryVoltage < 11.5}
                />
                <DataTile
                  label="연료잔량"
                  value={liveData?.fuelLevelPercent != null ? `${liveData.fuelLevelPercent}` : '-'}
                  unit="%"
                  highlight={liveData?.fuelLevelPercent != null && liveData.fuelLevelPercent < 15}
                />
                <DataTile
                  label="엔진부하"
                  value={liveData?.engineLoadPercent != null ? `${liveData.engineLoadPercent}` : '-'}
                  unit="%"
                  highlight={liveData?.engineLoadPercent != null && liveData.engineLoadPercent > 80}
                />
                <DataTile
                  label="스로틀"
                  value={liveData?.throttlePercent != null ? `${liveData.throttlePercent}` : '-'}
                  unit="%"
                  highlight={false}
                />
                <DataTile
                  label="흡기온도"
                  value={liveData?.intakeAirTempC != null ? `${liveData.intakeAirTempC}` : '-'}
                  unit="°C"
                  highlight={liveData?.intakeAirTempC != null && liveData.intakeAirTempC > 50}
                />
              </View>

              {liveData?.recordedAt && (
                <Text style={styles.recordedAt}>
                  마지막 업데이트: {new Date(liveData.recordedAt).toLocaleTimeString('ko-KR')}
                </Text>
              )}
            </View>

            {/* DTC 고장코드 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>고장코드 (DTC)</Text>
                <TouchableOpacity onPress={handleReadDtc} disabled={dtcLoading} style={styles.dtcReadBtn}>
                  {dtcLoading
                    ? <ActivityIndicator color="#60A5FA" size="small" />
                    : <Text style={styles.dtcReadText}>조회</Text>}
                </TouchableOpacity>
              </View>

              {liveData?.dtcCodes && liveData.dtcCodes.length > 0 ? (
                liveData.dtcCodes.map((code) => (
                  <View key={code} style={styles.dtcRow}>
                    <Text style={styles.dtcCode}>{code}</Text>
                    <Text style={styles.dtcDesc}>{dtcDescription(code)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.dtcEmpty}>고장코드 없음 — 조회 버튼을 눌러 확인하세요.</Text>
              )}
            </View>

            {/* 액션 버튼 */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.saveBtn]}
                onPress={saveToDb}
                disabled={saveState === 'saving'}>
                <Text style={styles.saveBtnText}>지금 저장</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.disconnectBtn]} onPress={handleDisconnect}>
                <Text style={styles.disconnectBtnText}>연결 해제</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function DataTile({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit: string;
  highlight: boolean;
}) {
  return (
    <View style={[styles.tile, highlight && styles.tileHighlight]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, highlight && styles.tileValueHighlight]}>{value}</Text>
      <Text style={styles.tileUnit}>{unit}</Text>
    </View>
  );
}

// 주요 DTC 코드 한국어 설명 (일부)
function dtcDescription(code: string): string {
  const map: Record<string, string> = {
    P0300: '랜덤/다중 실화 감지',
    P0301: '1번 실린더 실화',
    P0302: '2번 실린더 실화',
    P0303: '3번 실린더 실화',
    P0304: '4번 실린더 실화',
    P0171: '연료 희박 (Bank 1)',
    P0172: '연료 과농 (Bank 1)',
    P0420: '촉매 변환기 효율 저하',
    P0442: '증발가스 누출 (소량)',
    P0455: '증발가스 누출 (대량)',
    P0500: '차속 센서 오류',
    P0505: '공회전 제어 시스템 오류',
    P0700: '변속기 제어 시스템 오류',
  };
  return map[code] ?? '상세 정보 없음';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07101C',
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#0D1B2A',
    borderBottomColor: 'rgba(255,255,255,0.07)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  backText: {
    color: '#60A5FA',
    fontSize: 22,
  },
  headerCenter: {
    flex: 1,
  },
  title: {
    color: '#EAF0F8',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: '#5A7A9A',
    fontSize: 12,
    marginTop: 1,
  },
  statusDot: {
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  dotGreen: { backgroundColor: '#10B981' },
  dotGray: { backgroundColor: '#3D4E5E' },
  dotLabel: { fontSize: 10, fontWeight: '600' },
  dotLabelGreen: { color: '#10B981' },
  dotLabelGray: { color: '#5A7A9A' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  msgBox: {
    borderRadius: 10,
    padding: 12,
  },
  msgError: { backgroundColor: 'rgba(239,68,68,0.08)' },
  msgInfo: { backgroundColor: 'rgba(96,165,250,0.08)' },
  msgText: { fontSize: 13, fontWeight: '500' },
  msgErrorText: { color: '#EF4444' },
  msgInfoText: { color: '#60A5FA' },
  section: {
    backgroundColor: '#0D1B2A',
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#EAF0F8',
    fontSize: 15,
    fontWeight: '700',
  },
  scanBtn: {
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  scanBtnDisabled: { opacity: 0.6 },
  scanBtnText: {
    color: '#07101C',
    fontSize: 15,
    fontWeight: '700',
  },
  webNotice: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 10,
    padding: 12,
  },
  webNoticeText: {
    color: '#F59E0B',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  separator: {
    borderBottomColor: 'rgba(255,255,255,0.05)',
    borderBottomWidth: 1,
  },
  deviceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  deviceInfo: { flex: 1, gap: 2 },
  deviceName: { color: '#EAF0F8', fontSize: 14, fontWeight: '600' },
  deviceId: { color: '#5A7A9A', fontSize: 11 },
  deviceRight: { alignItems: 'flex-end', gap: 2 },
  rssi: { color: '#5A7A9A', fontSize: 11 },
  connectLabel: { color: '#60A5FA', fontSize: 13, fontWeight: '600' },
  emptyHint: {
    color: '#5A7A9A',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  dataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    flexBasis: '30%',
    flexGrow: 1,
    gap: 2,
    padding: 14,
  },
  tileHighlight: { backgroundColor: 'rgba(239,68,68,0.1)' },
  tileLabel: { color: '#5A7A9A', fontSize: 11, fontWeight: '500' },
  tileValue: { color: '#EAF0F8', fontSize: 22, fontWeight: '700' },
  tileValueHighlight: { color: '#EF4444' },
  tileUnit: { color: '#3D607A', fontSize: 11 },
  recordedAt: { color: '#3D607A', fontSize: 11, textAlign: 'right' },
  savedLabel: { color: '#10B981', fontSize: 12, fontWeight: '600' },
  errorLabel: { color: '#EF4444', fontSize: 12, fontWeight: '600' },
  dtcReadBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  dtcReadText: { color: '#60A5FA', fontSize: 13, fontWeight: '600' },
  dtcRow: {
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  dtcCode: { color: '#EF4444', fontWeight: '700', fontSize: 13, minWidth: 56 },
  dtcDesc: { color: '#9AB0C8', flex: 1, fontSize: 13 },
  dtcEmpty: { color: '#5A7A9A', fontSize: 13, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    paddingVertical: 14,
  },
  saveBtn: { backgroundColor: '#F59E0B' },
  saveBtnText: { color: '#07101C', fontSize: 14, fontWeight: '700' },
  disconnectBtn: { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', borderWidth: 1 },
  disconnectBtnText: { color: '#EF4444', fontSize: 14, fontWeight: '600' },
});
