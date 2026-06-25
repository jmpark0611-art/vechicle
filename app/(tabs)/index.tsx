import * as Location from 'expo-location';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateTime, formatTripDuration, isStaleActiveTrip } from '../../lib/format';
import { formatDbError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/request';

type Vehicle = {
  id: string;
  vehicle_number: string;
};

type ActiveTrip = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  status: string | null;
};

type TripLocation = Location.LocationObjectCoords;
type LocationSubscription = Location.LocationSubscription;
type VoiceTarget = 'start' | 'end';
type GpsPermissionStatus = 'unknown' | 'granted' | 'denied';
type SpeechRecognitionEventLike = {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const START_PLACE = '배송부';
const END_PLACE = '목적지';
const PLACE_PRESETS = ['배송부', '물류센터', '거래처', '차고지'];
const GPS_SAVE_RETRY_COUNT = 2;
const GPS_SAVE_RETRY_DELAY_MS = 1000;

function getSpeedKmh(coords: TripLocation | null) {
  return Math.max(0, (coords?.speed ?? 0) * 3.6);
}

function isValidCoords(coords: TripLocation) {
  return (
    Number.isFinite(coords.latitude) &&
    Number.isFinite(coords.longitude) &&
    Math.abs(coords.latitude) <= 90 &&
    Math.abs(coords.longitude) <= 180
  );
}

async function getBestLocation(lastLocation: TripLocation | null) {
  try {
    return await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
  } catch (error) {
    const fallback = await Location.getLastKnownPositionAsync({
      maxAge: 60_000,
      requiredAccuracy: 100,
    });

    if (fallback) {
      return fallback;
    }

    if (lastLocation) {
      return {
        coords: lastLocation,
        timestamp: Date.now(),
      } as Location.LocationObject;
    }

    throw error;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getVoiceErrorMessage(error?: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return '마이크 권한이 차단되었습니다. 브라우저 주소창의 마이크 권한을 허용한 뒤 다시 시도해 주세요.';
  }

  if (error === 'no-speech') {
    return '음성이 감지되지 않았습니다. 조용한 곳에서 다시 말해 주세요.';
  }

  if (error === 'audio-capture') {
    return '마이크 장치를 찾지 못했습니다. PC 또는 브라우저의 마이크 설정을 확인해 주세요.';
  }

  if (error === 'network') {
    return '브라우저 음성 인식 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  }

  return '음성 입력 중 오류가 발생했습니다. 직접 입력하거나 브라우저 마이크 권한을 확인해 주세요.';
}

function getGpsPermissionText(status: GpsPermissionStatus) {
  if (status === 'granted') {
    return '허용됨';
  }

  if (status === 'denied') {
    return '거부됨';
  }

  return '확인 전';
}

export default function DriverScreen() {
  const insets = useSafeAreaInsets();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [startPlace, setStartPlace] = useState(START_PLACE);
  const [endPlace, setEndPlace] = useState(END_PLACE);
  const [location, setLocation] = useState<TripLocation | null>(null);
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const [gpsPermissionStatus, setGpsPermissionStatus] = useState<GpsPermissionStatus>('unknown');
  const [gpsSaveFailureCount, setGpsSaveFailureCount] = useState(0);
  const [lastGpsSavedAt, setLastGpsSavedAt] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [listeningTarget, setListeningTarget] = useState<VoiceTarget | null>(null);
  const [, setMinuteTick] = useState(0);
  const locationSub = useRef<LocationSubscription | null>(null);
  const latestLocationRef = useRef<TripLocation | null>(null);

  const selectedVehicleText = selectedVehicle?.vehicle_number ?? '선택 안 됨';
  const speedKmh = useMemo(() => (isRunning ? getSpeedKmh(location) : 0), [isRunning, location]);
  const elapsedText = isRunning ? formatTripDuration(startTime, null) : '-';
  const isStaleRunningTrip = isRunning && isStaleActiveTrip(startTime);
  const gpsStatusText = isRunning ? (location ? '위치 수신' : '수집 대기') : '대기';

  useEffect(() => {
    latestLocationRef.current = location;
  }, [location]);

  const stopLocationWatch = useCallback(() => {
    locationSub.current?.remove();
    locationSub.current = null;
  }, []);

  const saveGpsPoint = useCallback(async (currentTripId: string, coords: TripLocation) => {
    if (!isValidCoords(coords)) {
      setGpsWarning('GPS 좌표가 올바르지 않아 저장하지 않았습니다.');
      return;
    }

    const recordedAt = new Date().toISOString();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= GPS_SAVE_RETRY_COUNT; attempt += 1) {
      let error: unknown = null;

      try {
        const result = await withTimeout(
          supabase.from('gps_points').insert({
            trip_id: currentTripId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            speed_kmh: getSpeedKmh(coords),
            recorded_at: recordedAt,
          }),
          'GPS 저장'
        );
        error = result.error;
      } catch (saveError) {
        error = saveError;
      }

      if (!error) {
        setGpsSaveFailureCount(0);
        setGpsWarning(null);
        setLastGpsSavedAt(recordedAt);
        return;
      }

      lastError = error;

      if (attempt < GPS_SAVE_RETRY_COUNT) {
        await wait(GPS_SAVE_RETRY_DELAY_MS);
      }
    }

    setGpsSaveFailureCount((count) => count + 1);
    setGpsWarning(`GPS 저장 실패: ${formatDbError(lastError)} 재시도 후에도 저장하지 못했습니다.`);
  }, []);

  const startLocationWatch = useCallback(
    async (currentTripId: string) => {
      stopLocationWatch();

      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        async (nextLocation) => {
          setLocation(nextLocation.coords);
          await saveGpsPoint(currentTripId, nextLocation.coords);
        }
      );
    },
    [saveGpsPoint, stopLocationWatch]
  );

  const restoreActiveTripWatch = useCallback(
    async (activeTripId: string) => {
      const permission = await Location.getForegroundPermissionsAsync();
      setGpsPermissionStatus(permission.status === 'granted' ? 'granted' : 'denied');

      if (permission.status !== 'granted') {
        setGpsWarning('진행 중인 운행을 복구했습니다. GPS 권한을 허용하면 위치 수집을 재개합니다.');
        return;
      }

      try {
        const loc = await getBestLocation(latestLocationRef.current);
        setLocation(loc.coords);
        await saveGpsPoint(activeTripId, loc.coords);
        await startLocationWatch(activeTripId);
        setGpsWarning(null);
      } catch (error) {
        setGpsWarning(
          error instanceof Error
            ? `진행 중인 운행은 복구했지만 GPS 재시작에 실패했습니다: ${error.message}`
            : '진행 중인 운행은 복구했지만 GPS 재시작에 실패했습니다.'
        );
      }
    },
    [saveGpsPoint, startLocationWatch]
  );

  const loadDashboard = useCallback(async () => {
    setIsLoadingDashboard(true);
    setVehicleError(null);

    try {
      const permission = await Location.getForegroundPermissionsAsync();
      setGpsPermissionStatus(permission.status === 'granted' ? 'granted' : 'denied');

      const [vehiclesResult, activeTripResult] = await Promise.all([
        withTimeout(
          supabase
            .from('vehicles')
            .select('id, vehicle_number')
            .order('vehicle_number', { ascending: true }),
          '차량 목록'
        ),
        withTimeout(
          supabase
            .from('trips')
            .select('id, vehicle_id, start_place, end_place, start_time, status')
            .eq('status', 'in_progress')
            .order('start_time', { ascending: false })
            .limit(1)
            .maybeSingle(),
          '진행 중 운행'
        ),
      ]);

      const nextVehicles = vehiclesResult.error ? [] : ((vehiclesResult.data ?? []) as Vehicle[]);
      const activeTrip = activeTripResult.error ? null : ((activeTripResult.data ?? null) as ActiveTrip | null);

      if (vehiclesResult.error) {
        setVehicleError(formatDbError(vehiclesResult.error, '차량 목록을 불러오는 중 오류가 발생했습니다.'));
      }

      if (activeTripResult.error) {
        setGpsWarning(`진행 중 운행 조회 실패: ${formatDbError(activeTripResult.error)}`);
      }

      setVehicles(nextVehicles);

      if (activeTrip) {
        const activeVehicle =
          nextVehicles.find((vehicle) => vehicle.id === activeTrip.vehicle_id) ??
          nextVehicles[0] ??
          null;
        setSelectedVehicle(activeVehicle);
        setTripId(activeTrip.id);
        setStartPlace(activeTrip.start_place ?? START_PLACE);
        setEndPlace(activeTrip.end_place ?? END_PLACE);
        setStartTime(activeTrip.start_time);
        setIsRunning(true);
        setRecoveryNotice(
          `진행 중 운행을 복구했습니다. 출발 시각: ${formatDateTime(activeTrip.start_time)}`
        );
        await restoreActiveTripWatch(activeTrip.id);
      } else {
        setSelectedVehicle((current) => current ?? nextVehicles[0] ?? null);
        setTripId(null);
        setStartTime(null);
        setIsRunning(false);
        setGpsWarning(null);
        setGpsSaveFailureCount(0);
        setLastGpsSavedAt(null);
        setRecoveryNotice(null);
        stopLocationWatch();
      }
    } catch (error) {
      setVehicles([]);
      setSelectedVehicle(null);
      setTripId(null);
      setStartTime(null);
      setIsRunning(false);
      setGpsWarning(null);
      setGpsSaveFailureCount(0);
      setLastGpsSavedAt(null);
      setRecoveryNotice(null);
      stopLocationWatch();
      setVehicleError(
        formatDbError(error, '운행 상태를 불러오는 중 오류가 발생했습니다.')
      );
    } finally {
      setIsLoadingDashboard(false);
    }
  }, [restoreActiveTripWatch, stopLocationWatch]);

  useEffect(() => {
    loadDashboard();

    return () => {
      stopLocationWatch();
    };
  }, [loadDashboard, stopLocationWatch]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && !isSubmitting) {
        loadDashboard();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isSubmitting, loadDashboard]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const timer = setInterval(() => {
      setMinuteTick((current) => current + 1);
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, [isRunning]);

  const handleVoiceInput = useCallback((target: VoiceTarget) => {
    setVoiceNotice(null);

    if (Platform.OS !== 'web') {
      const message = 'Expo Go에서는 기기 음성 인식 모듈이 필요합니다. 현재는 웹 브라우저에서 음성 입력을 사용할 수 있습니다.';
      setVoiceNotice(message);
      Alert.alert('음성 입력 안내', message);
      return;
    }

    const speechGlobal = globalThis as typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition = speechGlobal.SpeechRecognition ?? speechGlobal.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      const message = '현재 브라우저가 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 다시 시도해 주세요.';
      setVoiceNotice(message);
      Alert.alert('음성 입력 불가', message);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListeningTarget(target);
    setVoiceNotice('마이크 권한 요청이 보이면 허용을 눌러 주세요.');

    recognition.onstart = () => {
      setVoiceNotice('듣는 중입니다. 출발지 또는 목적지를 말해 주세요.');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();

      if (!transcript) {
        return;
      }

      if (target === 'start') {
        setStartPlace(transcript);
      } else {
        setEndPlace(transcript);
      }

      setVoiceNotice(`음성 입력 완료: ${transcript}`);
    };

    recognition.onerror = (event) => {
      const message = getVoiceErrorMessage(event.error);
      setVoiceNotice(message);
      Alert.alert('음성 입력 실패', message);
    };

    recognition.onend = () => {
      setListeningTarget(null);
    };

    recognition.start();
  }, []);

  const handleStart = async () => {
    if (isSubmitting || isRunning) {
      return;
    }

    if (!selectedVehicle) {
      Alert.alert('차량 선택 필요', '운행을 시작할 차량을 먼저 선택해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setGpsWarning(null);

    try {
      const activeTripResult = await withTimeout(
        supabase
          .from('trips')
          .select('id, vehicle_id, start_place, end_place, start_time, status')
          .eq('status', 'in_progress')
          .order('start_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
        '진행 중 운행'
      );

      if (activeTripResult.error) {
        Alert.alert('오류', formatDbError(activeTripResult.error));
        return;
      }

      const activeTrip = (activeTripResult.data ?? null) as ActiveTrip | null;

      if (activeTrip) {
        const activeVehicle =
          vehicles.find((vehicle) => vehicle.id === activeTrip.vehicle_id) ?? selectedVehicle;

        setSelectedVehicle(activeVehicle);
        setTripId(activeTrip.id);
        setStartPlace(activeTrip.start_place ?? START_PLACE);
        setEndPlace(activeTrip.end_place ?? END_PLACE);
        setStartTime(activeTrip.start_time);
        setIsRunning(true);
        setRecoveryNotice(
          `기존 진행 중 운행을 복구했습니다. 출발 시각: ${formatDateTime(activeTrip.start_time)}`
        );
        await restoreActiveTripWatch(activeTrip.id);
        Alert.alert('운행 복구', '이미 진행 중인 운행이 있어 새 운행 대신 기존 운행을 복구했습니다.');
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      setGpsPermissionStatus(status === 'granted' ? 'granted' : 'denied');

      if (status !== 'granted') {
        Alert.alert('GPS 권한 필요', '운행 기록을 위해 위치 권한을 허용해 주세요.');
        return;
      }

      const loc = await getBestLocation(latestLocationRef.current);
      const now = new Date().toISOString();
      const normalizedStartPlace = startPlace.trim() || START_PLACE;
      const normalizedEndPlace = endPlace.trim() || END_PLACE;

      if (!isValidCoords(loc.coords)) {
        Alert.alert('오류', '현재 GPS 좌표가 올바르지 않아 운행을 시작할 수 없습니다.');
        return;
      }

      setStartPlace(normalizedStartPlace);
      setEndPlace(normalizedEndPlace);
      setGpsSaveFailureCount(0);
      setLastGpsSavedAt(null);
      setRecoveryNotice(null);

      const { data, error } = await withTimeout(
        supabase
          .from('trips')
          .insert({
            vehicle_id: selectedVehicle.id,
            start_place: normalizedStartPlace,
            end_place: normalizedEndPlace,
            start_time: now,
            start_lat: loc.coords.latitude,
            start_lng: loc.coords.longitude,
            status: 'in_progress',
          })
          .select('id')
          .single(),
        '운행 시작'
      );

      if (error) {
        Alert.alert('오류', formatDbError(error, '운행 시작 중 오류가 발생했습니다.'));
        return;
      }

      setTripId(data.id);
      setStartTime(now);
      setLocation(loc.coords);
      setIsRunning(true);

      await saveGpsPoint(data.id, loc.coords);

      try {
        await startLocationWatch(data.id);
      } catch (watchError) {
        setGpsWarning(
          watchError instanceof Error
            ? `GPS 실시간 수집 시작 실패: ${watchError.message}`
            : 'GPS 실시간 수집을 시작하지 못했습니다.'
        );
      }

      Alert.alert('출발!', `${selectedVehicle.vehicle_number} 운행 시작`);
    } catch (error) {
      Alert.alert('오류', formatDbError(error, '운행 시작 중 오류가 발생했습니다.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnd = async () => {
    if (isSubmitting || !isRunning) {
      return;
    }

    if (!tripId) {
      Alert.alert('오류', '진행 중인 운행 정보를 찾을 수 없습니다.');
      stopLocationWatch();
      setIsRunning(false);
      return;
    }

    setIsSubmitting(true);

    try {
      const loc = await getBestLocation(latestLocationRef.current);
      const now = new Date().toISOString();

      if (!isValidCoords(loc.coords)) {
        Alert.alert('오류', '현재 GPS 좌표가 올바르지 않아 운행을 종료할 수 없습니다.');
        return;
      }

      const { error } = await withTimeout(
        supabase
          .from('trips')
          .update({
            end_time: now,
            end_lat: loc.coords.latitude,
            end_lng: loc.coords.longitude,
            status: 'completed',
          })
          .eq('id', tripId),
        '운행 종료'
      );

      if (error) {
        Alert.alert('오류', formatDbError(error, '운행 종료 중 오류가 발생했습니다.'));
        return;
      }

      await saveGpsPoint(tripId, loc.coords);
      stopLocationWatch();

      setIsRunning(false);
      setTripId(null);
      setStartTime(null);
      setLocation(loc.coords);
      setGpsSaveFailureCount(0);
      setRecoveryNotice(null);
      Alert.alert('도착!', '운행 완료!');
    } catch (error) {
      Alert.alert('오류', formatDbError(error, '운행 종료 중 오류가 발생했습니다.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom + 96, 112),
          paddingTop: Math.max(insets.top + 24, 56),
        },
      ]}>
      <Text style={styles.eyebrow}>DRIVER LOG</Text>
      <Text style={styles.title}>차량운행시스템</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>상태</Text>
          <Text style={[styles.summaryValue, isRunning ? styles.runningText : styles.waitingText]}>
            {isRunning ? '운행 중' : '대기 중'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>선택</Text>
          <Text style={styles.summaryValue}>{selectedVehicleText}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>출발지</Text>
          <Text style={styles.summaryValue}>{startPlace.trim() || START_PLACE}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>목적지</Text>
          <Text style={styles.summaryValue}>{endPlace.trim() || END_PLACE}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>출발</Text>
          <Text style={styles.summaryValue}>
            {formatDateTime(startTime)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>경과</Text>
          <Text style={[styles.summaryValue, isStaleRunningTrip && styles.staleText]}>{elapsedText}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>속도</Text>
          <Text style={styles.summaryValue}>{speedKmh.toFixed(1)} km/h</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GPS</Text>
          <Text style={[styles.summaryValue, isRunning && location ? styles.runningText : styles.waitingText]}>
            {gpsStatusText}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>위치 권한</Text>
          <Text
            style={[
              styles.summaryValue,
              gpsPermissionStatus === 'granted' ? styles.runningText : styles.waitingText,
              gpsPermissionStatus === 'denied' && styles.staleText,
            ]}>
            {getGpsPermissionText(gpsPermissionStatus)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>최근 저장</Text>
          <Text style={styles.summaryValue}>{formatDateTime(lastGpsSavedAt)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>저장 실패</Text>
          <Text style={[styles.summaryValue, gpsSaveFailureCount > 0 && styles.staleText]}>
            {gpsSaveFailureCount}회
          </Text>
        </View>
      </View>

      {gpsWarning && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>{gpsWarning}</Text>
        </View>
      )}

      {recoveryNotice && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{recoveryNotice}</Text>
        </View>
      )}

      {isStaleRunningTrip && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>8시간 이상 진행 중인 운행입니다. 실제 운행이 끝났다면 종료 버튼으로 마감해 주세요.</Text>
        </View>
      )}

      {isLoadingDashboard && (
        <View style={styles.noticeBox}>
          <ActivityIndicator color="#1565C0" />
          <Text style={styles.noticeText}>운행 상태를 확인하는 중입니다.</Text>
        </View>
      )}

      {!isRunning && (
        <>
          <View style={styles.inputCard}>
            <Text style={styles.sectionTitle}>운행 정보</Text>
            <View style={styles.inputLabelRow}>
              <Text style={styles.inputLabel}>출발지</Text>
              <TouchableOpacity
                accessibilityLabel="출발지 음성 입력"
                style={styles.voiceBtn}
                onPress={() => handleVoiceInput('start')}>
                <Text style={styles.voiceText}>{listeningTarget === 'start' ? '듣는 중' : '음성'}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              value={startPlace}
              onChangeText={setStartPlace}
              placeholder="출발지를 입력하세요"
              placeholderTextColor="#98A2B3"
            />
            <View style={styles.presetRow}>
              {PLACE_PRESETS.map((place) => (
                <TouchableOpacity key={`start-${place}`} style={styles.presetBtn} onPress={() => setStartPlace(place)}>
                  <Text style={styles.presetText}>{place}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.inputLabelRow}>
              <Text style={styles.inputLabel}>목적지</Text>
              <TouchableOpacity
                accessibilityLabel="목적지 음성 입력"
                style={styles.voiceBtn}
                onPress={() => handleVoiceInput('end')}>
                <Text style={styles.voiceText}>{listeningTarget === 'end' ? '듣는 중' : '음성'}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              value={endPlace}
              onChangeText={setEndPlace}
              placeholder="목적지를 입력하세요"
              placeholderTextColor="#98A2B3"
            />
            <View style={styles.presetRow}>
              {PLACE_PRESETS.map((place) => (
                <TouchableOpacity key={`end-${place}`} style={styles.presetBtn} onPress={() => setEndPlace(place)}>
                  <Text style={styles.presetText}>{place}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {voiceNotice && (
              <View style={styles.voiceNoticeBox}>
                <Text style={styles.voiceNoticeText}>{voiceNotice}</Text>
              </View>
            )}
          </View>

          <View style={styles.vehicleSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>차량 선택</Text>
              <TouchableOpacity
                accessibilityLabel="차량 목록 새로고침"
                onPress={loadDashboard}
                disabled={isLoadingDashboard}>
                <Text style={styles.reloadText}>새로고침</Text>
              </TouchableOpacity>
            </View>

            {vehicleError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>차량 조회 실패: {vehicleError}</Text>
              </View>
            )}

            {!isLoadingDashboard && !vehicleError && vehicles.length === 0 && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>등록된 차량이 없습니다.</Text>
              </View>
            )}

            {vehicles.length > 0 && (
              <View style={styles.selectBox}>
                {vehicles.map((vehicle) => {
                  const isSelected = selectedVehicle?.id === vehicle.id;

                  return (
                    <TouchableOpacity
                      key={vehicle.id}
                      style={[styles.vehicleBtn, isSelected && styles.selectedBtn]}
                      onPress={() => setSelectedVehicle(vehicle)}>
                      <Text style={[styles.vehicleTxt, isSelected && styles.selectedVehicleTxt]}>
                        {vehicle.vehicle_number}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </>
      )}

      {!isRunning ? (
        <TouchableOpacity
          accessibilityLabel="운행 출발"
          style={[
            styles.actionBtn,
            styles.startBtn,
            (!selectedVehicle || isSubmitting || isLoadingDashboard) && styles.disabledBtn,
          ]}
          onPress={handleStart}
          disabled={!selectedVehicle || isSubmitting || isLoadingDashboard}>
          <Text style={styles.btnText}>{isSubmitting ? '처리 중...' : '출발'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.runningActionRow}>
          {tripId && (
            <Link
              href={{
                pathname: '/trips/[id]',
                params: { id: tripId },
              }}
              asChild>
              <TouchableOpacity accessibilityLabel="진행 중 운행 상세 보기" style={styles.detailActionBtn}>
                <Text style={styles.detailActionText}>상세</Text>
              </TouchableOpacity>
            </Link>
          )}
          <TouchableOpacity
            accessibilityLabel="운행 종료"
            style={[styles.actionBtn, styles.runningEndBtn, styles.endBtn, isSubmitting && styles.disabledBtn]}
            onPress={handleEnd}
            disabled={isSubmitting}>
            <Text style={styles.btnText}>{isSubmitting ? '처리 중...' : '종료'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#F6F8FB',
    padding: 20,
  },
  eyebrow: {
    color: '#4F6F52',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 8,
  },
  title: {
    color: '#101828',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 24,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8EF',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
  },
  summaryRow: {
    alignItems: 'center',
    borderBottomColor: '#EEF2F6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  summaryLabel: {
    color: '#667085',
    fontSize: 15,
    fontWeight: '700',
  },
  summaryValue: {
    color: '#101828',
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '800',
    marginLeft: 16,
    textAlign: 'right',
  },
  runningText: {
    color: '#0E7C66',
  },
  waitingText: {
    color: '#7A4A00',
  },
  vehicleSection: {
    marginBottom: 22,
    marginTop: 8,
  },
  inputCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8EF',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  inputLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  inputLabel: {
    color: '#667085',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  voiceBtn: {
    backgroundColor: '#ECFDF3',
    borderColor: '#ABEFC6',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  voiceText: {
    color: '#087443',
    fontSize: 13,
    fontWeight: '900',
  },
  voiceNoticeBox: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  voiceNoticeText: {
    color: '#075985',
    fontSize: 13,
    fontWeight: '800',
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CFD7E6',
    borderRadius: 8,
    borderWidth: 1,
    color: '#101828',
    fontSize: 16,
    fontWeight: '700',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  presetBtn: {
    backgroundColor: '#EEF4FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetText: {
    color: '#1565C0',
    fontSize: 13,
    fontWeight: '900',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#25324B',
    fontSize: 18,
    fontWeight: '800',
  },
  reloadText: {
    color: '#1565C0',
    fontSize: 14,
    fontWeight: '800',
  },
  selectBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  vehicleBtn: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CFD7E6',
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 112,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectedBtn: {
    backgroundColor: '#1565C0',
    borderColor: '#1565C0',
  },
  vehicleTxt: {
    color: '#25324B',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  selectedVehicleTxt: {
    color: '#FFFFFF',
  },
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#EAF2FF',
    borderColor: '#BBD7FF',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  noticeText: {
    color: '#1D4E89',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  warningBox: {
    backgroundColor: '#FFF7E6',
    borderColor: '#FFD591',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  warningText: {
    color: '#8C5A00',
    fontSize: 14,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFCCC7',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  errorText: {
    color: '#A8071A',
    fontSize: 15,
    fontWeight: '700',
  },
  staleText: {
    color: '#A8071A',
  },
  actionBtn: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 72,
    width: '100%',
  },
  runningActionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  runningEndBtn: {
    flex: 1,
    width: 'auto',
  },
  detailActionBtn: {
    alignItems: 'center',
    backgroundColor: '#EEF4FF',
    borderColor: '#BBD7FF',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 72,
    width: 96,
  },
  detailActionText: {
    color: '#1565C0',
    fontSize: 17,
    fontWeight: '900',
  },
  startBtn: {
    backgroundColor: '#1565C0',
  },
  endBtn: {
    backgroundColor: '#D92D20',
  },
  disabledBtn: {
    opacity: 0.45,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
});
