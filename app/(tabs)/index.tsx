import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LoadingCard, RebuildScreen, SectionCard, StatusLine } from '@/components/rebuild-screen';
import {
  completeManualTrip,
  fetchActiveTrips,
  fetchVehiclesReadOnly,
  startManualTrip,
  type TripSummary,
  type VehicleSummary,
} from '@/lib/readonly-data';

function formatTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export default function TripScreen() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [userName, setUserName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startPlace, setStartPlace] = useState('본부대');
  const [endPlace, setEndPlace] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [selectedVehicleId, vehicles]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextVehicles, nextActiveTrips] = await Promise.all([fetchVehiclesReadOnly(50), fetchActiveTrips(20)]);
      setVehicles(nextVehicles);
      setActiveTrips(nextActiveTrips);
      setSelectedVehicleId((current) => current ?? nextVehicles[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '운행 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleStartTrip() {
    if (!selectedVehicleId) {
      Alert.alert('차량 선택 필요', '운행을 시작할 차량을 선택해 주세요.');
      return;
    }
    if (!startPlace.trim() || !endPlace.trim()) {
      Alert.alert('입력 필요', '출발지와 목적지를 입력해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const trip = await startManualTrip({
        vehicleId: selectedVehicleId,
        startPlace,
        endPlace,
        purpose,
        operatorName,
        userName,
      });
      setActiveTrips((current) => [trip, ...current]);
      setPurpose('');
      setEndPlace('');
      Alert.alert('운행 시작', `${trip.vehicleNumber} 운행을 시작했습니다.`);
    } catch (error) {
      Alert.alert('운행 시작 실패', error instanceof Error ? error.message : '운행을 시작하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteTrip(trip: TripSummary) {
    const finalEndPlace = endPlace.trim() || trip.endPlace || '목적지 미입력';
    setIsSaving(true);
    try {
      await completeManualTrip(trip.id, finalEndPlace);
      setActiveTrips((current) => current.filter((item) => item.id !== trip.id));
      Alert.alert('운행 종료', `${trip.vehicleNumber} 운행을 종료했습니다.`);
    } catch (error) {
      Alert.alert('운행 종료 실패', error instanceof Error ? error.message : '운행을 종료하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RebuildScreen
      title="운행"
      subtitle="GPS 없이 수동 입력으로 운행 시작과 종료를 저장합니다."
      metrics={[
        { label: '차량', value: `${vehicles.length}대` },
        { label: '진행 중', value: `${activeTrips.length}건` },
        { label: 'GPS', value: '보류' },
        { label: 'OBD', value: '보류' },
      ]}
      actionLabel={isSaving ? '저장 중' : '운행 시작'}
      onAction={() => void handleStartTrip()}>
      {isLoading ? (
        <LoadingCard label="운행 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="데이터 오류" body={errorMessage} />
      ) : (
        <>
          <SectionCard title="차량 선택" body={selectedVehicle ? selectedVehicle.vehicleNumber : '등록 차량이 없습니다.'}>
            <View style={styles.vehicleList}>
              {vehicles.map((vehicle) => (
                <Pressable
                  key={vehicle.id}
                  style={[styles.vehiclePill, selectedVehicleId === vehicle.id && styles.vehiclePillActive]}
                  onPress={() => setSelectedVehicleId(vehicle.id)}>
                  <Text style={[styles.vehiclePillText, selectedVehicleId === vehicle.id && styles.vehiclePillTextActive]}>
                    {vehicle.vehicleNumber}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SectionCard>

          <SectionCard title="운행 정보" body="운전자, 사용자, 목적, 출발지, 목적지를 입력합니다. 확장 컬럼이 없는 DB에서는 기본 운행 정보만 저장됩니다.">
            <TextInput style={styles.input} value={operatorName} onChangeText={setOperatorName} placeholder="운전자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={userName} onChangeText={setUserName} placeholder="사용자 성명" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="운행 목적" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={startPlace} onChangeText={setStartPlace} placeholder="출발지" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.input} value={endPlace} onChangeText={setEndPlace} placeholder="목적지" placeholderTextColor="#94A3B8" />
          </SectionCard>

          <SectionCard title="진행 중 운행" body="GPS 없이 수동으로 시작한 운행을 종료할 수 있습니다.">
            {activeTrips.length === 0 ? (
              <StatusLine label="상태" value="진행 중 운행 없음" />
            ) : (
              activeTrips.map((trip) => (
                <View key={trip.id} style={styles.activeTrip}>
                  <Text style={styles.activeTripTitle}>{trip.vehicleNumber}</Text>
                  <Text style={styles.activeTripRoute}>
                    {trip.startPlace ?? '출발지 없음'} → {trip.endPlace ?? '목적지 없음'}
                  </Text>
                  <StatusLine label="시작" value={formatTime(trip.startTime)} />
                  {trip.purpose ? <StatusLine label="목적" value={trip.purpose} /> : null}
                  {trip.operatorName ? <StatusLine label="운전자" value={trip.operatorName} /> : null}
                  <Pressable style={styles.completeBtn} onPress={() => void handleCompleteTrip(trip)} disabled={isSaving}>
                    <Text style={styles.completeBtnText}>운행 종료</Text>
                  </Pressable>
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
  vehicleList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  vehiclePill: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  vehiclePillActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  vehiclePillText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  vehiclePillTextActive: { color: '#2563EB' },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    marginTop: 12,
  },
  activeTrip: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14, marginTop: 14 },
  activeTripTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  activeTripRoute: { color: '#64748B', fontSize: 13, fontWeight: '700', marginTop: 5 },
  completeBtn: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  completeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
