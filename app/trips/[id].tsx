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
        <RefreshControl refreshing={isRefreshing} onRefresh={() => loadDetail(true)} />
      }>
      <Text style={styles.title}>운행 상세</Text>

      {isLoading && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#2563EB" />
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
              <Text style={styles.vehicleText}>{vehicleNumber}</Text>
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
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 14,
    padding: 18,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vehicleText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  statusBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 20,
    color: '#059669',
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  runningBadge: {
    backgroundColor: '#EFF6FF',
    color: '#2563EB',
  },
  staleBadge: {
    backgroundColor: '#FEF2F2',
    color: '#DC2626',
  },
  staleBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  staleText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
  },
  routeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  routeText: {
    color: '#334155',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  routeArrow: {
    color: '#94A3B8',
    fontSize: 14,
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
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  infoValue: {
    color: '#334155',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: '#2563EB',
    borderRadius: 12,
    flexBasis: 150,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
  },
  secondaryBtn: {
    backgroundColor: '#EFF6FF',
  },
  dangerOutlineBtn: {
    backgroundColor: '#FEF2F2',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#2563EB',
  },
  dangerOutlineText: {
    color: '#DC2626',
  },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#1D4ED8',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    marginBottom: 14,
    padding: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '500',
  },
});
