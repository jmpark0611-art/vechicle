import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { formatDateTime, formatTripDuration, getTripStatusText, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { withTimeout } from '../../lib/request';

type Trip = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
};

type Vehicle = {
  id: string;
  vehicle_number: string;
};

export default function TripDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const tripId = Array.isArray(id) ? id[0] : id;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const vehicleNumber = vehicle?.vehicle_number ?? '차량 정보 없음';
  const isStaleRunningTrip = trip?.status === 'in_progress' && isStaleActiveTrip(trip.start_time);

  const loadDetail = useCallback(
    async (refreshing = false) => {
      if (!tripId) {
        setErrorMessage('운행 ID가 없습니다.');
        setIsLoading(false);
        return;
      }

      if (refreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setErrorMessage(null);

      try {
        const tripResult = await withTimeout(
          supabase
            .from('trips')
            .select('id, vehicle_id, start_place, end_place, start_time, end_time, status')
            .eq('id', tripId)
            .single(),
          '운행 상세'
        );

        if (tripResult.error) {
          setTrip(null);
          setVehicle(null);
          setErrorMessage(formatDbError(tripResult.error, '운행 상세를 불러오는 중 오류가 발생했습니다.'));
          return;
        }

        const nextTrip = tripResult.data as Trip;
        setTrip(nextTrip);

        if (!nextTrip.vehicle_id) {
          setVehicle(null);
          return;
        }

        const vehicleResult = await withTimeout(
          supabase
            .from('vehicles')
            .select('id, vehicle_number')
            .eq('id', nextTrip.vehicle_id)
            .maybeSingle(),
          '차량 상세'
        );

        if (vehicleResult.error) {
          setVehicle(null);
          setErrorMessage((current) => current ?? formatDbError(vehicleResult.error));
        } else {
          setVehicle((vehicleResult.data ?? null) as Vehicle | null);
        }
      } catch (error) {
        setTrip(null);
        setVehicle(null);
        setErrorMessage(formatDbError(error, '운행 상세를 불러오는 중 오류가 발생했습니다.'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [tripId]
  );

  const handleCancelTrip = useCallback(() => {
    if (!tripId || trip?.status !== 'in_progress') {
      return;
    }

    Alert.alert('운행 무효 처리', '잘못 시작한 운행을 무효 처리할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '무효 처리',
        style: 'destructive',
        onPress: async () => {
          setIsRefreshing(true);
          setErrorMessage(null);

          try {
            const { error } = await withTimeout(
              supabase
                .from('trips')
                .update({
                  status: 'canceled',
                  end_time: new Date().toISOString(),
                })
                .eq('id', tripId),
              '운행 무효 처리'
            );

            if (error) {
              setErrorMessage(formatDbError(error, '운행 무효 처리 중 오류가 발생했습니다.'));
              return;
            }

            await loadDetail(true);
          } catch (error) {
            setErrorMessage(formatDbError(error, '운행 무효 처리 중 오류가 발생했습니다.'));
          } finally {
            setIsRefreshing(false);
          }
        },
      },
    ]);
  }, [loadDetail, trip?.status, tripId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom + 40, 56),
          paddingTop: Math.max(insets.top + 24, 32),
        },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => loadDetail(true)}
          tintColor="#A8FF5F"
        />
      }>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Text style={styles.headerIcon}>🧭</Text>
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>운행 상세</Text>
          <Text style={styles.subtitle}>차량 운행 상태와 시간을 확인합니다</Text>
        </View>
      </View>

      {isLoading && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#A8FF5F" />
          <Text style={styles.noticeText}>운행 상세를 불러오는 중입니다.</Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>상세 조회 실패: {errorMessage}</Text>
        </View>
      )}

      {trip && (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.cardHeader}>
              <View style={styles.vehicleTitleRow}>
                <Text style={styles.vehicleIcon}>🚗</Text>
                <Text style={styles.vehicleText}>{vehicleNumber}</Text>
              </View>
              <Text
                style={[
                  styles.statusBadge,
                  trip.status === 'in_progress' && styles.runningBadge,
                  isStaleRunningTrip && styles.staleBadge,
                ]}>
                {isStaleRunningTrip ? '장시간 운행' : getTripStatusText(trip.status)}
              </Text>
            </View>
            <View style={styles.routeRow}>
              <Text style={styles.routeText}>{trip.start_place ?? '출발지'}</Text>
              <Text style={styles.routeArrow}>→</Text>
              <Text style={styles.routeText}>{trip.end_place ?? '목적지'}</Text>
            </View>
            <InfoRow label="출발" value={formatDateTime(trip.start_time)} />
            <InfoRow label="종료" value={formatDateTime(trip.end_time)} />
            <InfoRow label="소요" value={formatTripDuration(trip.start_time, trip.end_time)} />
            {isStaleRunningTrip && (
              <View style={styles.staleBox}>
                <Text style={styles.staleText}>
                  8시간 이상 종료되지 않은 운행입니다. 운행 종료 여부를 확인해 주세요.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <Link href="/explore" asChild>
              <TouchableOpacity
                accessibilityLabel="운행 기록 화면으로 이동"
                style={[styles.actionBtn, styles.secondaryBtn]}>
                <Text style={[styles.actionText, styles.secondaryText]}>기록으로</Text>
              </TouchableOpacity>
            </Link>
            {trip.status === 'in_progress' && (
              <>
                <Link href="/" asChild>
                  <TouchableOpacity
                    accessibilityLabel="운행 종료 화면으로 이동"
                    style={styles.actionBtn}>
                    <Text style={styles.actionText}>운행 종료하기</Text>
                  </TouchableOpacity>
                </Link>
                <TouchableOpacity
                  accessibilityLabel="운행 무효 처리"
                  style={[styles.actionBtn, styles.dangerOutlineBtn]}
                  onPress={handleCancelTrip}
                  disabled={isRefreshing}>
                  <Text style={[styles.actionText, styles.dangerOutlineText]}>무효 처리</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#101112',
    padding: 20,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginBottom: 18,
  },
  iconBubble: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#3F463B',
    borderRadius: 30,
    borderWidth: 1,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  headerIcon: {
    fontSize: 32,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: '#AEB5BE',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  summaryCard: {
    backgroundColor: '#1F2023',
    borderColor: '#30343A',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  vehicleTitleRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  vehicleIcon: {
    fontSize: 28,
  },
  vehicleText: {
    color: '#F8FAFC',
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    minWidth: 0,
  },
  statusBadge: {
    backgroundColor: '#263A1D',
    borderRadius: 20,
    color: '#A8FF5F',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  runningBadge: {
    backgroundColor: '#1C352D',
    color: '#76E4B5',
  },
  staleBadge: {
    backgroundColor: '#3F2424',
    color: '#FF8A8A',
  },
  staleBox: {
    backgroundColor: '#3A2424',
    borderColor: '#5A2B2B',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  staleText: {
    color: '#FFB4B4',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  routeRow: {
    alignItems: 'center',
    backgroundColor: '#151719',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 14,
    padding: 12,
  },
  routeText: {
    color: '#E8EDF2',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 0,
  },
  routeArrow: {
    color: '#A8FF5F',
    fontSize: 16,
    fontWeight: '800',
    marginHorizontal: 10,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 30,
  },
  infoLabel: {
    color: '#9AA3AD',
    fontSize: 13,
    fontWeight: '600',
  },
  infoValue: {
    color: '#F8FAFC',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 14,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: '#A8FF5F',
    borderRadius: 12,
    flexBasis: 150,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
  },
  secondaryBtn: {
    backgroundColor: '#1F2023',
    borderColor: '#3F463B',
    borderWidth: 1,
  },
  dangerOutlineBtn: {
    backgroundColor: '#3A2424',
    borderColor: '#5A2B2B',
    borderWidth: 1,
  },
  actionText: {
    color: '#101112',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryText: {
    color: '#E8EDF2',
  },
  dangerOutlineText: {
    color: '#FF8A8A',
  },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#30343A',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#D8DEE6',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#3A2424',
    borderColor: '#5A2B2B',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  errorText: {
    color: '#FFB4B4',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
