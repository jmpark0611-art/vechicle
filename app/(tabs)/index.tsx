import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Alert,
  Linking,
  Modal,
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
import { dequeueAllGpsPoints, enqueueGpsPoint, getGpsQueueSize, QueuedGpsPoint } from '../../lib/gps-queue';
import { obdBle, ObdDevice, ObdLiveData, ObdConnectionState } from '../../lib/obd-ble';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/request';
import { DriverInfo, getDriverInfo, RANKS, saveDriverInfo } from '../../lib/driver-info';

type Vehicle = {
  id: string;
  vehicle_number: string;
  equipment_name: string | null;
  equipment_number: string | null;
  fuel_type: string | null;
  current_odometer: number | null;
  obd_device_id: string | null;
  obd_ios_device_id: string | null;
};

type ActiveTrip = {
  id: string;
  vehicle_id: string | null;
  start_place: string | null;
  end_place: string | null;
  start_time: string | null;
  status: string | null;
  start_odometer: number | null;
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
  const [gpsQueueSize, setGpsQueueSize] = useState(0);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [listeningTarget, setListeningTarget] = useState<VoiceTarget | null>(null);
  const [, setMinuteTick] = useState(0);
  const [driverInfo, setDriverInfoState] = useState<DriverInfo>({ unit: '', rank: '', name: '' });
  const [purpose, setPurpose] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [userName, setUserName] = useState('');
  const [operatorRank, setOperatorRank] = useState('');
  const [userRank, setUserRank] = useState('');
  const [rankModalTarget, setRankModalTarget] = useState<'operator' | 'user' | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const locationSub = useRef<LocationSubscription | null>(null);
  const latestLocationRef = useRef<TripLocation | null>(null);
  const selectedVehicleRef = useRef<Vehicle | null>(null);
  const startOdometerRef = useRef<number | null>(null);
  const startFuelPctRef = useRef<number | null>(null);
  const [obdState, setObdState] = useState<ObdConnectionState>('idle');
  const [obdLiveData, setObdLiveData] = useState<ObdLiveData | null>(null);
  const [obdDevices, setObdDevices] = useState<ObdDevice[]>([]);
  const [obdMessage, setObdMessage] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const selectedVehicleText = selectedVehicle?.vehicle_number ?? '선택 안 됨';
  const speedKmh = useMemo(() => (isRunning ? getSpeedKmh(location) : 0), [isRunning, location]);
  const elapsedText = isRunning ? formatTripDuration(startTime, null) : '-';
  const isStaleRunningTrip = isRunning && isStaleActiveTrip(startTime);
  const gpsStatusText = isRunning ? (location ? '위치 수신' : '수집 대기') : '대기';

  useEffect(() => {
    latestLocationRef.current = location;
  }, [location]);

  useEffect(() => {
    selectedVehicleRef.current = selectedVehicle;
  }, [selectedVehicle]);

  useEffect(() => {
    getDriverInfo().then(setDriverInfoState);
  }, []);


  useEffect(() => {
    obdBle.setCallbacks({
      onStateChange: (state, message) => {
        setObdState(state);
        setObdMessage(message ?? null);
        if (state === 'idle' || state === 'error' || state === 'disconnected') {
          setObdDevices([]);
        }
      },
      onDeviceFound: (device) => {
        setObdDevices((prev) => (prev.find((d) => d.id === device.id) ? prev : [...prev, device]));
        const sv = selectedVehicleRef.current;
        const myId = Platform.OS === 'android' ? sv?.obd_device_id : sv?.obd_ios_device_id;
        if (myId && myId === device.id) {
          obdBle.stopScan();
          void obdBle.connect(device.id).catch((e: unknown) => {
            setObdMessage(e instanceof Error ? e.message : '자동 연결 실패');
          });
        }
      },
      onData: (data) => {
        setObdLiveData(data);
      },
    });
    return () => {
      void obdBle.disconnect();
    };
  }, []);

  const obdSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const obdLiveDataRef = useRef<ObdLiveData | null>(null);

  useEffect(() => {
    obdLiveDataRef.current = obdLiveData;
  }, [obdLiveData]);

  useEffect(() => {
    if (obdState !== 'connected' || !isRunning || !selectedVehicle) {
      if (obdSaveTimerRef.current) {
        clearInterval(obdSaveTimerRef.current);
        obdSaveTimerRef.current = null;
      }
      return;
    }
    const vehicleId = selectedVehicle.id;
    const currentTripId = tripId;
    obdSaveTimerRef.current = setInterval(async () => {
      const data = obdLiveDataRef.current;
      if (!data) return;
      await supabase.from('obd_logs').insert({
        vehicle_id: vehicleId,
        trip_id: currentTripId ?? null,
        speed_kmh: data.speedKmh,
        rpm: data.rpm,
        coolant_temp_c: data.coolantTempC,
        battery_voltage: data.batteryVoltage,
        fuel_level_percent: data.fuelLevelPercent,
        engine_load_percent: data.engineLoadPercent,
        throttle_percent: data.throttlePercent,
        intake_air_temp_c: data.intakeAirTempC,
        ignition_status: data.ignitionOn ? 'on' : 'off',
        dtc_codes: data.dtcCodes,
        recorded_at: data.recordedAt,
      });
    }, 30_000);
    return () => {
      if (obdSaveTimerRef.current) {
        clearInterval(obdSaveTimerRef.current);
        obdSaveTimerRef.current = null;
      }
    };
  }, [obdState, isRunning, selectedVehicle, tripId]);

  const handleObdScan = useCallback(async () => {
    setObdDevices([]);
    setObdMessage(null);
    const on = await obdBle.checkBluetoothState();
    if (!on) {
      setObdMessage('블루투스가 꺼져 있습니다. 설정에서 켜주세요.');
      return;
    }
    obdBle.startScan();
    setTimeout(() => obdBle.stopScan(), 10_000);
  }, []);

  const handleObdConnect = useCallback(async (deviceId: string) => {
    setObdMessage(null);
    try {
      await obdBle.connect(deviceId);
      const sv = selectedVehicleRef.current;
      const column = Platform.OS === 'android' ? 'obd_device_id' : 'obd_ios_device_id';
      const currentId = Platform.OS === 'android' ? sv?.obd_device_id : sv?.obd_ios_device_id;
      if (sv && currentId !== deviceId) {
        const { error } = await supabase
          .from('vehicles')
          .update({ [column]: deviceId })
          .eq('id', sv.id);
        if (!error) {
          setSelectedVehicle((v) => (v ? { ...v, [column]: deviceId } : v));
        }
      }
    } catch (e) {
      setObdMessage(e instanceof Error ? e.message : '연결 실패');
    }
  }, []);

  const handleObdDisconnect = useCallback(async () => {
    await obdBle.disconnect();
    setObdLiveData(null);
    setObdDevices([]);
  }, []);

  const updateDriverInfo = useCallback((partial: Partial<DriverInfo>) => {
    setDriverInfoState((prev) => {
      const next = { ...prev, ...partial };
      void saveDriverInfo(next);
      return next;
    });
  }, []);

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
    await enqueueGpsPoint({
      tripId: currentTripId,
      latitude: coords.latitude,
      longitude: coords.longitude,
      speedKmh: getSpeedKmh(coords),
      recordedAt,
    });
    setGpsQueueSize(await getGpsQueueSize());
  }, []);

  const flushGpsQueue = useCallback(async () => {
    const queued = await dequeueAllGpsPoints();
    if (queued.length === 0) return;

    const failed: QueuedGpsPoint[] = [];
    for (const point of queued) {
      try {
        const { error } = await withTimeout(
          supabase.from('gps_points').insert({
            trip_id: point.tripId,
            latitude: point.latitude,
            longitude: point.longitude,
            speed_kmh: point.speedKmh,
            recorded_at: point.recordedAt,
          }),
          'GPS 큐 업로드'
        );
        if (error) failed.push(point);
      } catch {
        failed.push(point);
      }
    }

    for (const point of failed) {
      await enqueueGpsPoint(point);
    }

    const remaining = await getGpsQueueSize();
    setGpsQueueSize(remaining);
    if (queued.length > failed.length) {
      setGpsWarning(null);
    }
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
            .select('id, vehicle_number, equipment_name, equipment_number, fuel_type, current_odometer, obd_device_id, obd_ios_device_id')
            .order('vehicle_number', { ascending: true }),
          '차량 목록'
        ),
        withTimeout(
          supabase
            .from('trips')
            .select('id, vehicle_id, start_place, end_place, start_time, status, start_odometer')
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
        startOdometerRef.current = activeTrip.start_odometer ?? null;
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
    getGpsQueueSize().then(setGpsQueueSize);
    flushGpsQueue();

    return () => {
      stopLocationWatch();
    };
  }, [loadDashboard, stopLocationWatch, flushGpsQueue]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && !isSubmitting) {
        loadDashboard();
        flushGpsQueue();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isSubmitting, loadDashboard, flushGpsQueue]);

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

  useEffect(() => {
    if (!isRunning) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isRunning, pulseAnim]);

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
          .select('id, vehicle_id, start_place, end_place, start_time, status, start_odometer')
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
        startOdometerRef.current = activeTrip.start_odometer ?? null;
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

      let startOdoNum: number | null = selectedVehicle.current_odometer ?? null;
      startFuelPctRef.current = null;
      if (obdState === 'connected') {
        const [obdOdo, obdFuel] = await Promise.all([obdBle.readOdometerKm(), obdBle.readFuelSnapshot()]);
        if (obdOdo != null) startOdoNum = obdOdo;
        if (obdFuel != null) startFuelPctRef.current = obdFuel;
      }
      startOdometerRef.current = startOdoNum;

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
            purpose: purpose.trim() || null,
            operator_name: operatorName.trim() || null,
            operator_rank: operatorRank || null,
            user_name: userName.trim() || null,
            user_rank: userRank || null,
            start_odometer: startOdometerRef.current,
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

  const handleEnd = async (
    endOdometer: number | null = null,
    dailyKmVal: number | null = null,
    totalKmVal: number | null = null,
  ) => {
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
      const now = new Date().toISOString();

      let endLat: number | null = null;
      let endLng: number | null = null;
      try {
        const loc = await getBestLocation(latestLocationRef.current);
        if (isValidCoords(loc.coords)) {
          endLat = loc.coords.latitude;
          endLng = loc.coords.longitude;
          setLocation(loc.coords);
          await saveGpsPoint(tripId, loc.coords);
        }
      } catch {
        // GPS unavailable — proceed without end coordinates
      }

      const { error } = await withTimeout(
        supabase
          .from('trips')
          .update({
            end_time: now,
            end_lat: endLat,
            end_lng: endLng,
            status: 'completed',
            end_odometer: endOdometer,
            daily_km: dailyKmVal,
            total_km: totalKmVal,
          })
          .eq('id', tripId),
        '운행 종료'
      );

      if (error) {
        Alert.alert('오류', formatDbError(error, '운행 종료 중 오류가 발생했습니다.'));
        return;
      }

      if (endOdometer != null && selectedVehicle) {
        await withTimeout(
          supabase
            .from('vehicles')
            .update({ current_odometer: endOdometer })
            .eq('id', selectedVehicle.id),
          '오도미터 업데이트'
        ).catch(() => {});
      }

      stopLocationWatch();

      setIsRunning(false);
      setTripId(null);
      setStartTime(null);
      setGpsSaveFailureCount(0);
      setRecoveryNotice(null);
      startOdometerRef.current = null;
      startFuelPctRef.current = null;
      Alert.alert('도착!', '운행 완료!');
    } catch (error) {
      Alert.alert('오류', formatDbError(error, '운행 종료 중 오류가 발생했습니다.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEndPress = async () => {
    if (!tripId || isSubmitting) return;

    let endOdo: number | null = null;
    let fuelInfo = '';

    if (obdState === 'connected') {
      const [obdOdo, obdFuel] = await Promise.all([obdBle.readOdometerKm(), obdBle.readFuelSnapshot()]);
      endOdo = obdOdo;
      if (startFuelPctRef.current != null && obdFuel != null) {
        const consumed = startFuelPctRef.current - obdFuel;
        fuelInfo = `\n연료 소모: ${consumed.toFixed(0)}% (${startFuelPctRef.current}%→${obdFuel}%)`;
      } else if (obdFuel != null) {
        fuelInfo = `\n현재 연료: ${obdFuel}%`;
      }
    }

    const dailyKm =
      endOdo != null && startOdometerRef.current != null ? endOdo - startOdometerRef.current : null;

    const msg =
      endOdo != null
        ? `오도미터: ${endOdo.toLocaleString()} km\n주행: ${dailyKm?.toFixed(1) ?? '-'} km${fuelInfo}`
        : `OBD 미연결 — 거리 정보 없이 종료합니다.${fuelInfo}`;

    Alert.alert('운행 종료 확인', msg, [
      { text: '취소', style: 'cancel' },
      {
        text: '종료',
        style: 'destructive',
        onPress: () => void handleEnd(endOdo, dailyKm, endOdo),
      },
    ]);
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom + 84,
          paddingTop: Math.max(insets.top + 8, 20),
        },
      ]}>
      <View style={styles.topRow}>
        <Text style={styles.title}>운행</Text>
        {!isRunning && (
          <TouchableOpacity style={styles.modeSwitchBtn} onPress={() => router.replace('/role-select')}>
            <Text style={styles.modeSwitchText}>⇄ 수송부 모드</Text>
          </TouchableOpacity>
        )}
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
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.noticeText}>운행 상태를 확인하는 중입니다.</Text>
        </View>
      )}

      {isRunning ? (
        <>
          <LinearGradient
            colors={['#1D4ED8', '#2563EB']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.runningHeroCard}>
            <View style={styles.heroHeader}>
              <Animated.View style={[styles.statusDotActive, { opacity: pulseAnim }]} />
              <Text style={styles.heroStatusText}>운행 중</Text>
              <Text style={styles.heroVehicleText} numberOfLines={1}>{selectedVehicleText}</Text>
            </View>
            <View style={styles.heroMetrics}>
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricValue}>{speedKmh.toFixed(0)}</Text>
                <Text style={styles.heroMetricUnit}>km/h</Text>
              </View>
              <View style={styles.heroMetricDivider} />
              <View style={styles.heroMetric}>
                <Text style={[styles.heroMetricValue, isStaleRunningTrip && styles.heroStaleValue]}>
                  {elapsedText}
                </Text>
                <Text style={styles.heroMetricUnit}>경과</Text>
              </View>
            </View>
            <View style={styles.heroRoute}>
              <Text style={styles.heroRouteText} numberOfLines={1}>{startPlace}</Text>
              <Text style={styles.heroRouteArrow}>→</Text>
              <Text style={styles.heroRouteText} numberOfLines={1}>{endPlace}</Text>
            </View>
            <Text style={styles.heroStartTime}>출발 {formatDateTime(startTime)}</Text>
            {(driverInfo.name || driverInfo.unit) && (
              <Text style={styles.heroDriverText}>
                {[driverInfo.rank, driverInfo.name].filter(Boolean).join(' ')}
                {driverInfo.unit ? ` · ${driverInfo.unit}` : ''}
              </Text>
            )}
            {(operatorName || userName) && (
              <Text style={styles.heroDriverText}>
                {[
                  operatorName && `운용: ${[operatorRank, operatorName].filter(Boolean).join(' ')}`,
                  userName && `사용: ${[userRank, userName].filter(Boolean).join(' ')}`,
                ].filter(Boolean).join(' · ')}
              </Text>
            )}
            {obdLiveData && obdState === 'connected' && (
              <View style={styles.heroObdRow}>
                <Text style={styles.heroObdItem}>배터리 {obdLiveData.batteryVoltage ?? '-'}V</Text>
                <Text style={styles.heroObdItem}>연료 {obdLiveData.fuelLevelPercent ?? '-'}%</Text>
                <Text style={styles.heroObdItem}>냉각수 {obdLiveData.coolantTempC ?? '-'}°C</Text>
              </View>
            )}
          </LinearGradient>

          <View style={styles.gpsCard}>
            <View style={styles.gpsRow}>
              <Text style={styles.gpsLabel}>GPS</Text>
              <Text style={[styles.gpsValue, location ? styles.successText : styles.waitingText]}>
                {gpsStatusText}
              </Text>
            </View>
            {location?.accuracy != null && (
              <View style={styles.gpsRow}>
                <Text style={styles.gpsLabel}>GPS 오차</Text>
                <Text style={styles.gpsValue}>±{Math.round(location.accuracy)}m</Text>
              </View>
            )}
            <View style={styles.gpsRow}>
              <Text style={styles.gpsLabel}>위치 권한</Text>
              <View style={styles.gpsValueRow}>
                <Text style={[
                  styles.gpsValue,
                  gpsPermissionStatus === 'granted' ? styles.successText : styles.waitingText,
                  gpsPermissionStatus === 'denied' && styles.errorText,
                ]}>
                  {getGpsPermissionText(gpsPermissionStatus)}
                </Text>
                {gpsPermissionStatus === 'denied' && (
                  <TouchableOpacity onPress={() => void Linking.openSettings()} style={styles.settingsBtn}>
                    <Text style={styles.settingsBtnText}>설정 열기</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.gpsRow}>
              <Text style={styles.gpsLabel}>최근 저장</Text>
              <Text style={styles.gpsValue}>{formatDateTime(lastGpsSavedAt)}</Text>
            </View>
            <View style={[styles.gpsRow, gpsQueueSize === 0 && styles.gpsRowLast]}>
              <Text style={styles.gpsLabel}>저장 실패</Text>
              <Text style={[styles.gpsValue, gpsSaveFailureCount > 0 && styles.errorText]}>
                {gpsSaveFailureCount}회
              </Text>
            </View>
            {gpsQueueSize > 0 && (
              <View style={[styles.gpsRow, styles.gpsRowLast]}>
                <Text style={styles.gpsLabel}>미전송 큐</Text>
                <Text style={[styles.gpsValue, styles.waitingText]}>{gpsQueueSize}개</Text>
              </View>
            )}
            <View style={styles.obdStatusRow}>
              <View style={[styles.obdStatusDot, { backgroundColor: obdState === 'connected' ? '#16A34A' : '#94A3B8' }]} />
              <Text style={[styles.obdStatusText, { flex: 1 }]}>
                {obdState === 'connected'
                  ? 'OBD 연결됨'
                  : obdState === 'scanning' || obdState === 'connecting' || obdState === 'initializing'
                    ? 'OBD 연결 중...'
                    : 'OBD 미연결'}
              </Text>
              {obdState === 'connected' ? (
                <TouchableOpacity style={styles.obdInlineBtn} onPress={() => { void handleObdDisconnect(); }}>
                  <Text style={styles.obdInlineBtnText}>해제</Text>
                </TouchableOpacity>
              ) : obdState === 'scanning' || obdState === 'connecting' || obdState === 'initializing' ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <TouchableOpacity style={styles.obdInlineBtn} onPress={() => { void handleObdScan(); }}>
                  <Text style={styles.obdInlineBtnText}>검색</Text>
                </TouchableOpacity>
              )}
            </View>
            {obdMessage ? (
              <Text style={[styles.obdStatusMsg, obdState === 'error' && styles.obdStatusMsgError]}>{obdMessage}</Text>
            ) : null}
            {obdDevices.length > 0 && obdState !== 'connected' && (
              <View style={styles.obdDeviceList}>
                {obdDevices.map((device) => {
                  const myId = Platform.OS === 'android' ? selectedVehicle?.obd_device_id : selectedVehicle?.obd_ios_device_id;
                  const isRegistered = !!myId && myId === device.id;
                  return (
                    <TouchableOpacity
                      key={device.id}
                      style={[styles.obdDeviceItem, isRegistered && styles.obdDeviceItemRegistered]}
                      onPress={() => { void handleObdConnect(device.id); }}
                      disabled={obdState === 'connecting' || obdState === 'initializing'}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.obdDeviceName}>{device.name}</Text>
                        {isRegistered && <Text style={styles.obdDeviceRegisteredLabel}>이 차량 등록 단말기</Text>}
                      </View>
                      {device.rssi != null && <Text style={styles.obdDeviceRssi}>{device.rssi} dBm</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </>
      ) : (
        <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
              <TouchableOpacity style={styles.dropdownBtn} onPress={() => setShowVehicleModal(true)}>
                <View style={{ flex: 1 }}>
                  <Text style={selectedVehicle ? styles.dropdownBtnText : styles.dropdownPlaceholder}>
                    {selectedVehicle ? selectedVehicle.vehicle_number : '차량 선택'}
                  </Text>
                  {selectedVehicle?.equipment_name ? (
                    <Text style={styles.dropdownSubText}>{selectedVehicle.equipment_name}</Text>
                  ) : null}
                </View>
                <Text style={styles.dropdownArrow}>▾</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.driverCard}>
            <View style={styles.fieldGroupRow}>
              <View style={styles.fieldGroupCol}>
                <Text style={styles.fieldLabel}>운용자 *</Text>
                <TouchableOpacity
                  style={styles.rankChip}
                  onPress={() => setRankModalTarget('operator')}>
                  <Text style={operatorRank ? styles.rankChipTextFilled : styles.rankChipText}>
                    {operatorRank || '계급'}
                  </Text>
                  <Text style={styles.rankChipArrow}>▾</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.routeInput}
                  value={operatorName}
                  onChangeText={setOperatorName}
                  placeholder="성명"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <View style={styles.fieldGroupCol}>
                <Text style={styles.fieldLabel}>사용자 *</Text>
                <TouchableOpacity
                  style={styles.rankChip}
                  onPress={() => setRankModalTarget('user')}>
                  <Text style={userRank ? styles.rankChipTextFilled : styles.rankChipText}>
                    {userRank || '계급'}
                  </Text>
                  <Text style={styles.rankChipArrow}>▾</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.routeInput}
                  value={userName}
                  onChangeText={setUserName}
                  placeholder="성명"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>운행 목적</Text>
              <TextInput
                style={styles.routeInput}
                value={purpose}
                onChangeText={setPurpose}
                placeholder="운행 목적 입력"
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          <View style={styles.routeCard}>
            <View style={styles.routeFieldBlock}>
              <Text style={styles.fieldLabel}>출발지</Text>
              <TextInput
                style={styles.routeInput}
                value={startPlace}
                onChangeText={setStartPlace}
                placeholder="예: 사단 본부"
                placeholderTextColor="#94A3B8"
              />
            </View>
            <View style={styles.routeFieldBlock}>
              <Text style={styles.fieldLabel}>목적지</Text>
              <TextInput
                style={styles.routeInput}
                value={endPlace}
                onChangeText={setEndPlace}
                placeholder="예: 1연대"
                placeholderTextColor="#94A3B8"
              />
            </View>
            <View style={styles.obdStatusRow}>
              <View style={[styles.obdStatusDot, { backgroundColor: obdState === 'connected' ? '#16A34A' : '#94A3B8' }]} />
              <Text style={[styles.obdStatusText, { flex: 1 }]}>
                {obdState === 'connected'
                  ? 'OBD 연결됨 · 오도미터·연료 자동 수집'
                  : obdState === 'scanning' || obdState === 'connecting' || obdState === 'initializing'
                    ? 'OBD 연결 중...'
                    : 'OBD 미연결'}
              </Text>
              {obdState === 'connected' ? (
                <TouchableOpacity style={styles.obdInlineBtn} onPress={() => { void handleObdDisconnect(); }}>
                  <Text style={styles.obdInlineBtnText}>해제</Text>
                </TouchableOpacity>
              ) : obdState === 'scanning' || obdState === 'connecting' || obdState === 'initializing' ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <TouchableOpacity style={styles.obdInlineBtn} onPress={() => { void handleObdScan(); }}>
                  <Text style={styles.obdInlineBtnText}>검색</Text>
                </TouchableOpacity>
              )}
            </View>
            {obdMessage ? (
              <Text style={[styles.obdStatusMsg, obdState === 'error' && styles.obdStatusMsgError]}>{obdMessage}</Text>
            ) : null}
            {obdDevices.length > 0 && obdState !== 'connected' && (
              <View style={styles.obdDeviceList}>
                {obdDevices.map((device) => {
                  const myId = Platform.OS === 'android' ? selectedVehicle?.obd_device_id : selectedVehicle?.obd_ios_device_id;
                  const isRegistered = !!myId && myId === device.id;
                  return (
                    <TouchableOpacity
                      key={device.id}
                      style={[styles.obdDeviceItem, isRegistered && styles.obdDeviceItemRegistered]}
                      onPress={() => { void handleObdConnect(device.id); }}
                      disabled={obdState === 'connecting' || obdState === 'initializing'}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.obdDeviceName}>{device.name}</Text>
                        {isRegistered && <Text style={styles.obdDeviceRegisteredLabel}>이 차량 등록 단말기</Text>}
                      </View>
                      {device.rssi != null && <Text style={styles.obdDeviceRssi}>{device.rssi} dBm</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {obdState === 'connected' && obdLiveData && (
              <View style={styles.obdDataGrid}>
                <View style={styles.obdDataItem}>
                  <Text style={styles.obdDataLabel}>배터리</Text>
                  <Text style={styles.obdDataValue}>{obdLiveData.batteryVoltage != null ? `${obdLiveData.batteryVoltage.toFixed(1)}V` : '-'}</Text>
                </View>
                <View style={styles.obdDataItem}>
                  <Text style={styles.obdDataLabel}>연료</Text>
                  <Text style={styles.obdDataValue}>{obdLiveData.fuelLevelPercent != null ? `${obdLiveData.fuelLevelPercent}%` : '-'}</Text>
                </View>
                <View style={styles.obdDataItem}>
                  <Text style={styles.obdDataLabel}>냉각수</Text>
                  <Text style={styles.obdDataValue}>{obdLiveData.coolantTempC != null ? `${obdLiveData.coolantTempC}°C` : '-'}</Text>
                </View>
              </View>
            )}
            {voiceNotice && (
              <View style={styles.voiceNoticeBox}>
                <Text style={styles.voiceNoticeText}>{voiceNotice}</Text>
              </View>
            )}
          </View>
        </ScrollView>
        <TouchableOpacity
          accessibilityLabel="운행 출발"
          style={[
            styles.startBtn,
            (!selectedVehicle || !operatorName.trim() || !userName.trim() || isSubmitting || isLoadingDashboard) && styles.disabledBtn,
          ]}
          onPress={handleStart}
          disabled={!selectedVehicle || !operatorName.trim() || !userName.trim() || isSubmitting || isLoadingDashboard}>
          <Text style={styles.btnText}>{isSubmitting ? '처리 중...' : '출발'}</Text>
        </TouchableOpacity>
        {(!operatorName.trim() || !userName.trim()) && (
          <Text style={styles.startHint}>운용자·사용자 성명을 입력하면 출발 가능합니다.</Text>
        )}
        </View>
      )}
      {!isRunning ? null : (
        <View style={styles.runningActionRow}>
          {tripId && (
            <Link
              href={{
                pathname: '/trips/[id]',
                params: { id: tripId },
              }}
              asChild>
              <TouchableOpacity accessibilityLabel="진행 중 운행 상세 보기" style={styles.detailBtn}>
                <Text style={styles.detailBtnText}>상세</Text>
              </TouchableOpacity>
            </Link>
          )}
          <TouchableOpacity
            accessibilityLabel="운행 종료"
            style={[styles.endBtn, styles.endBtnFlex, isSubmitting && styles.disabledBtn]}
            onPress={handleEndPress}
            disabled={isSubmitting}>
            <Text style={styles.btnText}>{isSubmitting ? '처리 중...' : '종료'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Rank picker modal */}
      <Modal visible={rankModalTarget !== null} transparent animationType="slide" onRequestClose={() => setRankModalTarget(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRankModalTarget(null)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {rankModalTarget === 'operator' ? '운용자 계급 선택' : '사용자 계급 선택'}
            </Text>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.rankGrid}>
                {RANKS.map((rank) => {
                  const currentRank = rankModalTarget === 'operator' ? operatorRank : userRank;
                  const isActive = currentRank === rank;
                  return (
                    <TouchableOpacity
                      key={rank}
                      style={[styles.rankGridBtn, isActive && styles.rankGridBtnActive]}
                      onPress={() => {
                        if (rankModalTarget === 'operator') setOperatorRank(rank);
                        else if (rankModalTarget === 'user') setUserRank(rank);
                        setRankModalTarget(null);
                      }}>
                      <Text style={[styles.rankGridText, isActive && styles.rankGridTextActive]}>{rank}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Vehicle picker modal */}
      <Modal visible={showVehicleModal} transparent animationType="slide" onRequestClose={() => setShowVehicleModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowVehicleModal(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>차량 선택</Text>
            <ScrollView style={styles.modalScroll}>
              {vehicles.map((vehicle) => {
                const isActive = selectedVehicle?.id === vehicle.id;
                return (
                  <TouchableOpacity
                    key={vehicle.id}
                    style={[styles.modalItem, isActive && styles.modalItemActive]}
                    onPress={() => { setSelectedVehicle(vehicle); setShowVehicleModal(false); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalItemText, isActive && styles.modalItemTextActive]}>
                        {vehicle.vehicle_number}
                      </Text>
                      <Text style={styles.modalItemSub}>
                        {[vehicle.equipment_name, vehicle.equipment_number, vehicle.fuel_type, vehicle.current_odometer != null ? `${vehicle.current_odometer.toLocaleString()} km` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {isActive && <Text style={styles.modalCheckmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 16,
  },
  topRow: {
    alignItems: 'flex-start',
    gap: 18,
    marginBottom: 8,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  modeSwitchBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#DBEAFE',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeSwitchText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '800',
  },
  // Running hero card — LinearGradient provides the colour
  runningHeroCard: {
    borderRadius: 16,
    marginBottom: 8,
    padding: 14,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statusDotActive: {
    backgroundColor: '#4ADE80',
    borderRadius: 5,
    height: 8,
    width: 8,
  },
  heroStatusText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  heroVehicleText: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  heroMetrics: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 28,
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroMetric: {
    alignItems: 'center',
  },
  heroMetricValue: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  heroStaleValue: {
    color: '#FCA5A5',
  },
  heroMetricUnit: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  heroMetricDivider: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 40,
    width: 1,
  },
  heroRoute: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8,
  },
  heroRouteText: {
    color: 'rgba(255,255,255,0.85)',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  heroRouteArrow: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    marginHorizontal: 10,
  },
  heroStartTime: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '400',
  },
  // GPS status card
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    padding: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  gpsRow: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  gpsRowLast: {
    borderBottomWidth: 0,
  },
  gpsLabel: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  gpsValue: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  gpsValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  settingsBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  settingsBtnText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
  },
  successText: {
    color: '#059669',
  },
  waitingText: {
    color: '#D97706',
  },
  // Idle status card
  idleCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  idleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statusDotIdle: {
    backgroundColor: '#CBD5E1',
    borderRadius: 5,
    height: 8,
    width: 8,
  },
  idleStatusText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
  idleVehicleText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  // Input form
  vehicleSection: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 4,
    padding: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  inputCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  inputLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  inputLabel: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  voiceBtn: {
    backgroundColor: '#ECFDF5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  voiceText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '600',
  },
  voiceNoticeBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    marginTop: 14,
    padding: 12,
  },
  voiceNoticeText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '500',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  presetBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  presetText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
  },
  reloadText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  selectBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  vehicleBtn: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 100,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectedBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  vehicleTxt: {
    color: '#64748B',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  selectedVehicleTxt: {
    color: '#2563EB',
  },
  // Notices
  noticeBox: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    padding: 14,
  },
  noticeText: {
    color: '#1D4ED8',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  warningBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    marginBottom: 12,
    padding: 14,
  },
  warningText: {
    color: '#B45309',
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    marginBottom: 12,
    padding: 14,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '500',
  },
  // Buttons
  startBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 48,
    width: '100%',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  endBtn: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  endBtnFlex: {
    flexBasis: 160,
    flexGrow: 1,
  },
  disabledBtn: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  runningActionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  detailBtn: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    width: 80,
  },
  detailBtnText: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '600',
  },
  // Driver info card
  driverCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 4,
    padding: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  fieldGroup: {
    marginBottom: 6,
  },
  fieldGroupRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  fieldGroupCol: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  rankScroll: {
    marginTop: 2,
  },
  rankRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 2,
  },
  rankBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rankBtnActive: {
    backgroundColor: '#2563EB',
  },
  rankText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  rankTextActive: {
    color: '#FFFFFF',
  },
  // Route card with dot layout
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 4,
    padding: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  dotRouteRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
  },
  dotCol: {
    alignItems: 'center',
    paddingTop: 15,
    width: 14,
  },
  dotFilled: {
    backgroundColor: '#2563EB',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  dotLine: {
    backgroundColor: '#CBD5E1',
    flex: 1,
    marginVertical: 6,
    width: 2,
    minHeight: 28,
  },
  dotHollow: {
    borderColor: '#2563EB',
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    width: 10,
  },
  routeFieldCol: {
    flex: 1,
    gap: 14,
  },
  routeFieldBlock: {
    gap: 4,
    marginTop: 6,
  },
  routeInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  // Hero driver info
  heroDriverText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 6,
  },
  // Rank + name row
  rankNameRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  rankChip: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  rankChipText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
  rankChipTextFilled: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  rankChipArrow: {
    color: '#94A3B8',
    fontSize: 11,
  },
  rankNameInput: {
    flex: 1,
    minWidth: 0,
  },
  obdInfoValue: {
    color: '#059669',
    fontSize: 14,
    fontWeight: '700',
  },
  obdInlineBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#DBEAFE',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  obdInlineBtnText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  obdStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  obdStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  obdStatusText: {
    fontSize: 12,
    color: '#64748B',
    flex: 1,
  },
  // Dropdown button
  dropdownBtn: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dropdownBtnText: {
    color: '#0F172A',
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
  },
  dropdownPlaceholder: {
    color: '#94A3B8',
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
  },
  dropdownArrow: {
    color: '#94A3B8',
    fontSize: 16,
    marginLeft: 8,
  },
  dropdownSubText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  // Field row (two columns side by side)
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  // Modal overlay + sheet
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 32,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalScroll: {
    flexGrow: 0,
  },
  // Rank grid inside modal
  rankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 8,
  },
  rankGridBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rankGridBtnActive: {
    backgroundColor: '#2563EB',
  },
  rankGridText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  rankGridTextActive: {
    color: '#FFFFFF',
  },
  // Vehicle list items inside modal
  modalItem: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  modalItemActive: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  modalItemText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
  },
  modalItemTextActive: {
    color: '#2563EB',
  },
  modalItemSub: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  modalCheckmark: {
    color: '#2563EB',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
  },
  // OBD panel
  obdCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  obdCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  obdScanBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  obdScanBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  obdStopBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  obdStopBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  obdStatusMsg: {
    color: '#64748B',
    fontSize: 13,
    marginBottom: 10,
  },
  obdStatusMsgError: {
    color: '#DC2626',
  },
  obdDeviceList: {
    gap: 8,
    marginBottom: 8,
  },
  obdDeviceItem: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  obdDeviceName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  obdDeviceRssi: {
    color: '#94A3B8',
    fontSize: 12,
  },
  obdDeviceItemRegistered: {
    borderColor: '#93C5FD',
    backgroundColor: '#EFF6FF',
  },
  obdDeviceRegisteredLabel: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  obdDataGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  obdDataItem: {
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  obdDataLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
  },
  obdDataValue: {
    color: '#059669',
    fontSize: 16,
    fontWeight: '700',
  },
  heroObdRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    marginTop: 10,
  },
  heroObdItem: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
  startHint: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 10,
    textAlign: 'center',
  },
});
