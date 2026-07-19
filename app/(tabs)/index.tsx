import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Pressable, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadingCard, RebuildScreen, SectionCard } from '@/components/rebuild-screen';
import { VehicleDropdown } from '@/components/vehicle-dropdown';
import { fetchTripGpsDistances, saveCurrentGpsPoint } from '@/lib/gps-data';
import { fetchLocationSnapshot } from '@/lib/location-data';
import {
  getVehicleMaintenanceState,
  loadSyncedMaintenanceSnapshot,
  mergeVehicleCurrentKm,
  setVehicleCurrentKm,
  type MaintenanceSnapshot,
} from '@/lib/maintenance-data';
import { buildObdReadingFromLiveData, saveLocalObdReading, saveTripObdLog } from '@/lib/obd-data';
import {
  getVehicleNumberForObdDevice,
  loadSelectedObdBleDevice,
  obdBle,
  saveSelectedObdBleDevice,
  scanForObdBleDevices,
  type ObdBleDevice,
  type ObdLiveData,
} from '@/lib/obd-ble';
import {
  cancelManualTrip,
  completeManualTrip,
  createVehicle,
  fetchActiveTrips,
  fetchLatestVehicleOdometers,
  fetchVehiclesReadOnly,
  startManualTrip,
  type TripSummary,
  type VehicleSummary,
} from '@/lib/readonly-data';
import { getStoredRole } from '@/lib/role';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const OVERSPEED_VIBRATION_PATTERN = [0, 650, 160, 650, 160, 900];
const DRIVER_SPEED_CHECK_MS = 10_000;

function formatTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function formatClock(value: Date) {
  return `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`;
}

function formatElapsed(startTime: string | null, now: Date) {
  if (!startTime) return '-';
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return '-';
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined) return '- km';
  return `${Math.round(value).toLocaleString('ko-KR')} km`;
}

function formatDistanceKm(value: number | null) {
  if (value === null) return '-';
  if (value < 1) return `${Math.round(value * 1000).toLocaleString('ko-KR')} m`;
  return `${value.toLocaleString('ko-KR')} km`;
}

function displayObdDeviceName(deviceName: string | null | undefined, vehicleNumber?: string | null) {
  if (!deviceName || /^OBD 단말기$|이름 없는 BLE|unknown/i.test(deviceName)) {
    return vehicleNumber ? `${vehicleNumber} OBD 단말기` : 'OBD 단말기';
  }
  return deviceName;
}

function parseKm(value: string) {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type CompletionSummary = {
  vehicleNumber: string;
  route: string;
  startTime: string;
  endTime: string;
  totalOdometer: string;
  tripDistance: string;
  gpsDistance: string;
  fuelUsed: string;
  purpose: string;
  operator: string;
  user: string;
};

export default function TripScreen() {
  const insets = useSafeAreaInsets();
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [operatorRank, setOperatorRank] = useState('');
  const [userName, setUserName] = useState('');
  const [userRank, setUserRank] = useState('');
  const [sameUser, setSameUser] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [startPlace, setStartPlace] = useState('본부대');
  const [endPlace, setEndPlace] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [lastCompletion, setLastCompletion] = useState<CompletionSummary | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [activeGpsDistanceKm, setActiveGpsDistanceKm] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maintenanceSnapshot, setMaintenanceSnapshot] = useState<MaintenanceSnapshot>({});
  const [obdLiveData, setObdLiveData] = useState<ObdLiveData | null>(null);
  const [isObdConnected, setIsObdConnected] = useState(false);
  const [isObdConnecting, setIsObdConnecting] = useState(false);
  const [obdStatus, setObdStatus] = useState('자동연결 준비');
  const [savedBleDeviceId, setSavedBleDeviceId] = useState<string | null>(null);
  const [savedBleDeviceName, setSavedBleDeviceName] = useState<string | null>(null);

  const activeTripsRef = useRef<TripSummary[]>([]);
  const obdLiveRef = useRef<ObdLiveData | null>(null);
  const tripStartFuelRef = useRef<Record<string, number | null>>({});
  const obdSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const obdRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const obdSnapshotSaveAtRef = useRef<Record<string, number>>({});
  const overspeedAlertedKeyRef = useRef<string | null>(null);

  activeTripsRef.current = activeTrips;
  obdLiveRef.current = obdLiveData;

  const activeTrip = activeTrips[0] ?? null;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
  const currentVehicleNumber = activeTrip?.vehicleNumber ?? selectedVehicle?.vehicleNumber ?? null;
  const selectedCurrentKm = selectedVehicleId
    ? getVehicleMaintenanceState(maintenanceSnapshot, selectedVehicleId).currentKm
    : null;

  const selectVehicleForObdDevice = useCallback(async (device: ObdBleDevice, sourceVehicles = vehicles) => {
    const vehicleNumber = getVehicleNumberForObdDevice(device);
    if (!vehicleNumber) return null;

    const existing = sourceVehicles.find((vehicle) => vehicle.vehicleNumber.toLowerCase() === vehicleNumber.toLowerCase());
    if (existing) {
      setSelectedVehicleId(existing.id);
      return existing;
    }

    try {
      const created = await createVehicle(vehicleNumber);
      setVehicles((current) => {
        const alreadyExists = current.some((vehicle) => vehicle.id === created.id || vehicle.vehicleNumber.toLowerCase() === vehicleNumber.toLowerCase());
        return alreadyExists ? current : [...current, created].sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber, 'ko-KR'));
      });
      setSelectedVehicleId(created.id);
      return created;
    } catch {
      try {
        const nextVehicles = await fetchVehiclesReadOnly(200);
        const existingAfterReload = nextVehicles.find((vehicle) => vehicle.vehicleNumber.toLowerCase() === vehicleNumber.toLowerCase());
        setVehicles(nextVehicles);
        if (existingAfterReload) {
          setSelectedVehicleId(existingAfterReload.id);
          return existingAfterReload;
        }
      } catch {
        // Keep OBD connection flow running even if vehicle auto-registration lookup fails.
      }
      return null;
    }
  }, [vehicles]);

  const stopObdSaveTimer = useCallback(() => {
    if (obdSaveTimerRef.current !== null) {
      clearInterval(obdSaveTimerRef.current);
      obdSaveTimerRef.current = null;
    }
  }, []);

  const stopGpsTimer = useCallback(() => {
    if (gpsTimerRef.current !== null) {
      clearInterval(gpsTimerRef.current);
      gpsTimerRef.current = null;
    }
  }, []);

  const checkOverspeedWarning = useCallback(async (tripIds?: string[]) => {
    const activeTripIds = new Set(tripIds ?? activeTripsRef.current.map((trip) => trip.id));
    if (activeTripIds.size === 0) return;

    try {
      const snapshot = await fetchLocationSnapshot();
      const overspeed = snapshot.alerts.find((alert) => alert.status === 'overspeed' && activeTripIds.has(alert.tripId));
      if (!overspeed) return;

      const speed = Math.round(overspeed.speedKmh ?? 0);
      const key = `${overspeed.tripId}-${overspeed.zoneName}-${speed}`;
      if (overspeedAlertedKeyRef.current === key) return;
      overspeedAlertedKeyRef.current = key;

      Vibration.vibrate(OVERSPEED_VIBRATION_PATTERN);
      Alert.alert(
        '제한속도 초과 경고',
        `${overspeed.vehicleNumber}\n${overspeed.zoneName}\n현재 ${speed}km/h / 제한 ${Math.round(overspeed.speedLimitKmh)}km/h\n\n즉시 감속해 주세요.`
      );
    } catch {
      // Speed-zone warning must not block trip recording.
    }
  }, []);

  const startObdSaveTimer = useCallback(() => {
    stopObdSaveTimer();
    obdSaveTimerRef.current = setInterval(() => {
      const live = obdLiveRef.current;
      if (!live || activeTripsRef.current.length === 0) return;
      for (const trip of activeTripsRef.current) {
        if (trip.vehicleId) void saveTripObdLog(trip.vehicleId, trip.id, live);
      }
    }, 30_000);
  }, [stopObdSaveTimer]);

  const startGpsTimer = useCallback(() => {
    stopGpsTimer();
    gpsTimerRef.current = setInterval(() => {
      void (async () => {
        const speedKmh = obdLiveRef.current?.speedKmh ?? null;
        await Promise.all(activeTripsRef.current.map((trip) => saveCurrentGpsPoint(trip.id, speedKmh)));
        await checkOverspeedWarning();
      })();
    }, DRIVER_SPEED_CHECK_MS);
  }, [checkOverspeedWarning, stopGpsTimer]);

  const stopObdRetryTimer = useCallback(() => {
    if (obdRetryTimerRef.current !== null) {
      clearInterval(obdRetryTimerRef.current);
      obdRetryTimerRef.current = null;
    }
  }, []);

  const ensureObdConnected = useCallback(async () => {
    if (isObdConnected || isObdConnecting) return;

    setIsObdConnecting(true);
    try {
      let deviceId = savedBleDeviceId;
      let deviceName = displayObdDeviceName(savedBleDeviceName, currentVehicleNumber);
      const usedSavedDevice = Boolean(deviceId);

      if (!deviceId) {
        setObdStatus('OBD 단말기 자동 검색 중');
        const scan = await scanForObdBleDevices();
        if (!scan.ok || scan.devices.length === 0) {
          setObdStatus(scan.message || 'OBD 단말기 검색 실패 · 자동 재시도 중');
          return;
        }
        const device = scan.devices[0];
        const namedDevice = { ...device, name: displayObdDeviceName(device.name, currentVehicleNumber) };
        await saveSelectedObdBleDevice(namedDevice);
        await selectVehicleForObdDevice(namedDevice);
        deviceId = device.id;
        deviceName = namedDevice.name;
        setSavedBleDeviceId(device.id);
        setSavedBleDeviceName(namedDevice.name);
      }

      setObdStatus(`${deviceName ?? 'OBD'} 연결 중`);
      const result = await obdBle.connect(deviceId);
      if (!result.ok) {
        if (usedSavedDevice) {
          await obdBle.disconnect();
          setObdStatus(`${deviceName ?? 'OBD'} 재검색 중`);
          const scan = await scanForObdBleDevices(2_000);
          const retryDevice = scan.devices.find((device) => device.id === savedBleDeviceId) ?? scan.devices[0] ?? null;
          if (retryDevice) {
            const namedDevice = { ...retryDevice, name: displayObdDeviceName(retryDevice.name, currentVehicleNumber) };
            await saveSelectedObdBleDevice(namedDevice);
            await selectVehicleForObdDevice(namedDevice);
            deviceId = namedDevice.id;
            deviceName = namedDevice.name;
            setSavedBleDeviceId(namedDevice.id);
            setSavedBleDeviceName(namedDevice.name);
            setObdStatus(`${deviceName ?? 'OBD'} 재연결 중`);
            const retryResult = await obdBle.connect(deviceId);
            if (retryResult.ok) {
              setIsObdConnected(true);
              setObdStatus(`${deviceName ?? 'OBD'} 연결됨`);
              obdBle.startPolling(2000);
              startObdSaveTimer();
              stopObdRetryTimer();
              return;
            }
          }
        }
        setIsObdConnected(false);
        setObdStatus(`${deviceName ?? 'OBD'} 연결 실패 · 자동 재시도 중`);
        return;
      }

      setIsObdConnected(true);
      setObdStatus(`${deviceName ?? 'OBD'} 연결됨`);
      obdBle.startPolling(2000);
      startObdSaveTimer();
      stopObdRetryTimer();
    } catch (error) {
      setIsObdConnected(false);
      setObdStatus(error instanceof Error ? `자동연결 오류 · ${error.message}` : '자동연결 오류 · 자동 재시도 중');
    } finally {
      setIsObdConnecting(false);
    }
  }, [currentVehicleNumber, isObdConnected, isObdConnecting, savedBleDeviceId, savedBleDeviceName, selectVehicleForObdDevice, startObdSaveTimer, stopObdRetryTimer]);

  useEffect(() => {
    obdBle.setCallbacks({
      onData: (data: ObdLiveData) => {
        setObdLiveData(data);
        setIsObdConnected(true);
        setIsObdConnecting(false);
        setObdStatus(`연결됨 · ${data.speedKmh ?? '-'}km/h · 연료 ${data.fuelPercent ?? '-'}%`);
        const now = Date.now();
        for (const trip of activeTripsRef.current) {
          if (!trip.vehicleId) continue;
          const previousSaveAt = obdSnapshotSaveAtRef.current[trip.vehicleId] ?? 0;
          if (now - previousSaveAt > 30_000) {
            obdSnapshotSaveAtRef.current[trip.vehicleId] = now;
            void saveLocalObdReading(buildObdReadingFromLiveData(trip.vehicleId, data));
          }
        }
        if (typeof data.fuelPercent === 'number') {
          for (const trip of activeTripsRef.current) {
            if (tripStartFuelRef.current[trip.id] === null || tripStartFuelRef.current[trip.id] === undefined) {
              tripStartFuelRef.current[trip.id] = data.fuelPercent;
            }
          }
        }
      },
      onStatus: setObdStatus,
      onDisconnect: () => {
        setObdLiveData(null);
        setIsObdConnected(false);
        setIsObdConnecting(false);
        setObdStatus('연결 끊김 · 자동 재시도 중');
        stopObdSaveTimer();
      },
    });

    return () => {
      obdBle.stopPolling();
      void obdBle.disconnect();
      stopObdSaveTimer();
      stopGpsTimer();
      stopObdRetryTimer();
    };
  }, [stopGpsTimer, stopObdSaveTimer, stopObdRetryTimer]);

  useEffect(() => {
    void loadSelectedObdBleDevice().then((device) => {
      if (device) {
        setSavedBleDeviceId(device.id);
        const deviceName = displayObdDeviceName(device.name, currentVehicleNumber);
        setSavedBleDeviceName(deviceName);
        setObdStatus(`${deviceName} 자동연결 준비`);
        void selectVehicleForObdDevice(device);
      }
    });
    void getStoredRole().then((nextRole) => {
      if (nextRole === 'commander') router.replace('/(tabs)/explore');
    });
  }, [currentVehicleNumber, selectVehicleForObdDevice]);

  useEffect(() => {
    if (sameUser) {
      setUserRank(operatorRank);
      setUserName(operatorName);
    }
  }, [operatorName, operatorRank, sameUser]);

  useEffect(() => {
    if (!activeTrip && selectedCurrentKm !== null && !startOdometer.trim()) {
      setStartOdometer(String(Math.round(selectedCurrentKm)));
    }
  }, [activeTrip, selectedCurrentKm, startOdometer]);

  useEffect(() => {
    const timerId = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!activeTrip) {
      setActiveGpsDistanceKm(null);
      return;
    }

    const refreshGpsDistance = async () => {
      try {
        const distances = await fetchTripGpsDistances([activeTrip.id]);
        setActiveGpsDistanceKm(distances[activeTrip.id] ?? 0);
      } catch {
        setActiveGpsDistanceKm(null);
      }
    };

    void refreshGpsDistance();
    const timerId = setInterval(() => void refreshGpsDistance(), 15_000);
    return () => clearInterval(timerId);
  }, [activeTrip]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextVehicles, nextActiveTrips] = await Promise.all([fetchVehiclesReadOnly(200), fetchActiveTrips(20)]);
      const vehicleIds = nextVehicles.map((vehicle) => vehicle.id);
      const maintenance = await loadSyncedMaintenanceSnapshot(vehicleIds);
      const latestOdometers = await fetchLatestVehicleOdometers(vehicleIds);
      const nextMaintenanceSnapshot = await mergeVehicleCurrentKm(maintenance.snapshot, latestOdometers);
      setVehicles(nextVehicles);
      setActiveTrips(nextActiveTrips);
      setMaintenanceSnapshot(nextMaintenanceSnapshot);
      setSelectedVehicleId((current) => current ?? nextVehicles[0]?.id ?? null);
      if (nextActiveTrips.length > 0) startGpsTimer();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '운행 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [startGpsTimer]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!activeTrip) {
      stopObdRetryTimer();
      return;
    }
    void ensureObdConnected();
    if (obdRetryTimerRef.current === null) {
      obdRetryTimerRef.current = setInterval(() => {
        if (!obdBle.isConnected) void ensureObdConnected();
      }, 12_000);
    }
    return stopObdRetryTimer;
  }, [activeTrip, ensureObdConnected, stopObdRetryTimer]);

  useEffect(() => {
    if (isLoading || errorMessage || activeTrip || lastCompletion || !selectedVehicleId || !savedBleDeviceId) {
      return;
    }

    void ensureObdConnected();
    const retryId = setInterval(() => {
      if (!obdBle.isConnected) void ensureObdConnected();
    }, 6_000);

    return () => clearInterval(retryId);
  }, [activeTrip, ensureObdConnected, errorMessage, isLoading, lastCompletion, savedBleDeviceId, selectedVehicleId]);

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
        operatorRank,
        userName: sameUser ? operatorName : userName,
        userRank: sameUser ? operatorRank : userRank,
        startOdometer: parseKm(startOdometer) ?? selectedCurrentKm ?? undefined,
      });
      setActiveTrips([trip]);
      tripStartFuelRef.current[trip.id] = typeof obdLiveData?.fuelPercent === 'number' ? obdLiveData.fuelPercent : null;
      setLastCompletion(null);
      setPurpose('');
      setEndPlace('');

      void ensureObdConnected();

      const gpsResult = await saveCurrentGpsPoint(trip.id, obdLiveRef.current?.speedKmh ?? null);
      await checkOverspeedWarning([trip.id]);
      startGpsTimer();
      Alert.alert('운행 시작', `${trip.vehicleNumber} 운행을 시작했습니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 시작 실패', error instanceof Error ? error.message : '운행을 시작하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelTrip(trip: TripSummary) {
    setIsSaving(true);
    try {
      await cancelManualTrip(trip.id);
      setActiveTrips([]);
      delete tripStartFuelRef.current[trip.id];
      stopGpsTimer();
    } catch (error) {
      Alert.alert('취소 실패', error instanceof Error ? error.message : '운행을 취소하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteTrip(trip: TripSummary) {
    const finalEndPlace = endPlace.trim() || trip.endPlace || '목적지 미입력';
    const startOdo = trip.startOdometer ?? parseKm(startOdometer);
    setIsSaving(true);
    try {
      if (isObdConnected && obdLiveData && trip.vehicleId) await saveTripObdLog(trip.vehicleId, trip.id, obdLiveData);
      const gpsResult = await saveCurrentGpsPoint(trip.id, obdLiveRef.current?.speedKmh ?? null);
      const gpsDistances = await fetchTripGpsDistances([trip.id]);
      const gpsDistanceKm = gpsDistances[trip.id] ?? 0;
      const autoEndOdo =
        startOdo !== undefined && gpsDistanceKm > 0
          ? Math.round(startOdo + gpsDistanceKm)
          : selectedCurrentKm !== null
            ? Math.round(selectedCurrentKm)
            : undefined;
      await completeManualTrip(trip.id, finalEndPlace, autoEndOdo, startOdo);
      if (trip.vehicleId && autoEndOdo !== undefined) {
        const nextSnapshot = await setVehicleCurrentKm(trip.vehicleId, autoEndOdo);
        setMaintenanceSnapshot(nextSnapshot);
      }
      const startFuel = tripStartFuelRef.current[trip.id];
      const endFuel = typeof obdLiveData?.fuelPercent === 'number' ? obdLiveData.fuelPercent : null;
      const fuelUsed = startFuel !== null && endFuel !== null && startFuel >= endFuel
        ? `${Math.round((startFuel - endFuel) * 10) / 10}%`
        : '-';
      setLastCompletion({
        vehicleNumber: trip.vehicleNumber,
        route: `${trip.startPlace ?? '-'} → ${finalEndPlace}`,
        startTime: formatTime(trip.startTime),
        endTime: formatTime(new Date().toISOString()),
        totalOdometer: formatKm(autoEndOdo),
        tripDistance: autoEndOdo !== undefined && startOdo !== undefined && autoEndOdo >= startOdo ? `${Math.round(autoEndOdo - startOdo).toLocaleString('ko-KR')} km` : '-',
        gpsDistance: gpsDistanceKm > 0 ? `${gpsDistanceKm.toLocaleString('ko-KR')} km` : '-',
        fuelUsed,
        purpose: trip.purpose || purpose || '-',
        operator: [trip.operatorRank, trip.operatorName].filter(Boolean).join(' ') || [operatorRank, operatorName].filter(Boolean).join(' ') || '-',
        user: [trip.userRank, trip.userName].filter(Boolean).join(' ') || [sameUser ? operatorRank : userRank, sameUser ? operatorName : userName].filter(Boolean).join(' ') || '-',
      });
      setActiveTrips([]);
      setPurpose('');
      setEndPlace('');
      setStartOdometer('');
      delete tripStartFuelRef.current[trip.id];
      obdBle.stopPolling();
      void obdBle.disconnect();
      stopObdSaveTimer();
      stopGpsTimer();
      setIsObdConnected(false);
      setIsObdConnecting(false);
      setObdLiveData(null);
      setObdStatus(savedBleDeviceName ? `${savedBleDeviceName} 자동연결 준비` : '자동연결 준비');
      Alert.alert('운행 종료', `안전운행해주셔서 감사합니다.\n${gpsResult.message}`);
    } catch (error) {
      Alert.alert('운행 종료 실패', error instanceof Error ? error.message : '운행을 종료하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  function handlePrimaryAction() {
    if (activeTrip) void handleCompleteTrip(activeTrip);
    else void handleStartTrip();
  }

  const obdLabel = isObdConnected
    ? `연결됨 · ${obdLiveData?.speedKmh ?? '-'}km/h · 연료 ${obdLiveData?.fuelPercent ?? '-'}%`
    : isObdConnecting
      ? obdStatus
      : obdStatus;
  const activeStartFuel = activeTrip ? tripStartFuelRef.current[activeTrip.id] : null;
  const activeFuelUsed =
    activeStartFuel !== null &&
    activeStartFuel !== undefined &&
    typeof obdLiveData?.fuelPercent === 'number' &&
    activeStartFuel >= obdLiveData.fuelPercent
      ? `${Math.round((activeStartFuel - obdLiveData.fuelPercent) * 10) / 10}%`
      : '-';
  const activeStartOdometer = activeTrip?.startOdometer ?? selectedCurrentKm;

  if (!isLoading && !errorMessage && activeTrip) {
    return (
      <View style={[styles.driverScreen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.driverTitle}>운행</Text>
        <View style={[styles.tripCard, styles.tripCardFullscreen]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.kicker}>운행 중</Text>
              <Text style={styles.activeTitle}>{activeTrip.vehicleNumber}</Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          </View>
          <View style={styles.routePanel}>
            <Text style={styles.routePoint}>{activeTrip.startPlace ?? '-'}</Text>
            <Text style={styles.routeArrow}>→</Text>
            <Text style={styles.routePoint}>{activeTrip.endPlace ?? '-'}</Text>
          </View>
          <View style={styles.liveInfoRow}>
            <View style={styles.liveInfoCard}>
              <Text style={styles.liveInfoLabel}>현재 시각</Text>
              <Text style={styles.liveInfoValue}>{formatClock(now)}</Text>
            </View>
            <View style={styles.liveInfoCard}>
              <Text style={styles.liveInfoLabel}>경과</Text>
              <Text style={styles.liveInfoValue}>{formatElapsed(activeTrip.startTime, now)}</Text>
            </View>
            <View style={styles.liveInfoCard}>
              <Text style={styles.liveInfoLabel}>GPS 이동</Text>
              <Text style={styles.liveInfoValue}>{formatDistanceKm(activeGpsDistanceKm)}</Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>시작</Text>
              <Text style={styles.statValue}>{formatTime(activeTrip.startTime)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>계기판 누적거리</Text>
              <Text style={styles.statValue}>{formatKm(activeStartOdometer)}</Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>현재 연료</Text>
              <Text style={styles.statValue}>{typeof obdLiveData?.fuelPercent === 'number' ? `${obdLiveData.fuelPercent}%` : '-'}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>소모 유류</Text>
              <Text style={styles.statValue}>{activeFuelUsed}</Text>
            </View>
          </View>
          <View style={styles.obdStrip}>
            <Text style={styles.obdStripLabel}>OBD</Text>
            <Text style={styles.obdStripValue}>{obdLabel}</Text>
          </View>
          <View style={styles.autoOdoBox}>
            <Text style={styles.autoOdoLabel}>도착 계기판 자동</Text>
            <Text style={styles.autoOdoValue}>
              {activeStartOdometer !== null ? `${Math.round(activeStartOdometer).toLocaleString('ko-KR')}km + GPS 이동거리` : 'OBD/GPS 기준 자동 저장'}
            </Text>
          </View>
          <View style={styles.tripFlexibleSpace} />
          <View style={styles.actionRow}>
            <Pressable style={styles.cancelBtnWide} onPress={() => void handleCancelTrip(activeTrip)} disabled={isSaving}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </Pressable>
            <Pressable style={styles.endBtn} onPress={handlePrimaryAction} disabled={isSaving}>
              <Text style={styles.endBtnText}>{isSaving ? '저장 중' : '운행 종료'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!isLoading && !errorMessage && lastCompletion) {
    return (
      <View style={[styles.driverScreen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.driverTitle}>운행</Text>
        <View style={styles.completionFullscreen}>
          <View style={styles.thanksCard}>
            <Text style={styles.thanksTitle}>안전운행해주셔서 감사합니다</Text>
            <Text style={styles.thanksSub}>월장비운행증 반영 요소</Text>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>차량</Text><Text style={styles.summaryVal}>{lastCompletion.vehicleNumber}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>경로</Text><Text style={styles.summaryVal}>{lastCompletion.route}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>출발/도착</Text><Text style={styles.summaryVal}>{lastCompletion.startTime} / {lastCompletion.endTime}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>계기판 총 주행거리</Text><Text style={styles.summaryVal}>{lastCompletion.totalOdometer}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>계기판 운행거리</Text><Text style={styles.summaryVal}>{lastCompletion.tripDistance}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>실제 이동거리</Text><Text style={styles.summaryVal}>{lastCompletion.gpsDistance}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>소모 유류</Text><Text style={styles.summaryVal}>{lastCompletion.fuelUsed}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>운행목적</Text><Text style={styles.summaryVal}>{lastCompletion.purpose}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>운행자</Text><Text style={styles.summaryVal}>{lastCompletion.operator}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>사용자</Text><Text style={styles.summaryVal}>{lastCompletion.user}</Text></View>
          </View>
          <Pressable style={styles.startBtn} onPress={() => setLastCompletion(null)}>
            <Text style={styles.startBtnText}>새 운행 입력</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <RebuildScreen title="운행" bottomSpace="none">
      {isLoading ? (
        <LoadingCard label="운행 데이터를 불러오는 중" />
      ) : errorMessage ? (
        <SectionCard title="오류" body={errorMessage} />
      ) : activeTrip ? (
        <View style={[styles.tripCard, styles.tripCardActive]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.kicker}>운행 중</Text>
              <Text style={styles.activeTitle}>{activeTrip.vehicleNumber}</Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          </View>
          <View style={styles.routePanel}>
            <Text style={styles.routePoint}>{activeTrip.startPlace ?? '-'}</Text>
            <Text style={styles.routeArrow}>→</Text>
            <Text style={styles.routePoint}>{activeTrip.endPlace ?? '-'}</Text>
          </View>
          <View style={styles.liveInfoRow}>
            <View style={styles.liveInfoCard}>
              <Text style={styles.liveInfoLabel}>현재 시각</Text>
              <Text style={styles.liveInfoValue}>{formatClock(now)}</Text>
            </View>
            <View style={styles.liveInfoCard}>
              <Text style={styles.liveInfoLabel}>경과</Text>
              <Text style={styles.liveInfoValue}>{formatElapsed(activeTrip.startTime, now)}</Text>
            </View>
            <View style={styles.liveInfoCard}>
              <Text style={styles.liveInfoLabel}>GPS 이동</Text>
              <Text style={styles.liveInfoValue}>{formatDistanceKm(activeGpsDistanceKm)}</Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>시작</Text>
              <Text style={styles.statValue}>{formatTime(activeTrip.startTime)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>계기판 누적거리</Text>
              <Text style={styles.statValue}>{formatKm(activeStartOdometer)}</Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>현재 연료</Text>
              <Text style={styles.statValue}>{typeof obdLiveData?.fuelPercent === 'number' ? `${obdLiveData.fuelPercent}%` : '-'}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>소모 유류</Text>
              <Text style={styles.statValue}>{activeFuelUsed}</Text>
            </View>
          </View>
          <View style={styles.obdStrip}>
            <Text style={styles.obdStripLabel}>OBD</Text>
            <Text style={styles.obdStripValue}>{obdLabel}</Text>
          </View>
          <View style={styles.autoOdoBox}>
            <Text style={styles.autoOdoLabel}>도착 계기판 자동</Text>
            <Text style={styles.autoOdoValue}>
              {activeStartOdometer !== null ? `${Math.round(activeStartOdometer).toLocaleString('ko-KR')}km + GPS 이동거리` : 'OBD/GPS 기준 자동 저장'}
            </Text>
          </View>
          <View style={styles.tripFlexibleSpace} />
          <View style={styles.actionRow}>
            <Pressable style={styles.cancelBtnWide} onPress={() => void handleCancelTrip(activeTrip)} disabled={isSaving}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </Pressable>
            <Pressable style={styles.endBtn} onPress={handlePrimaryAction} disabled={isSaving}>
              <Text style={styles.endBtnText}>{isSaving ? '저장 중' : '운행 종료'}</Text>
            </Pressable>
          </View>
        </View>
      ) : lastCompletion ? (
        <View style={styles.completionWrap}>
          <View style={styles.thanksCard}>
            <Text style={styles.thanksTitle}>안전운행해주셔서 감사합니다</Text>
            <Text style={styles.thanksSub}>월장비운행증 반영 요소</Text>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>차량</Text><Text style={styles.summaryVal}>{lastCompletion.vehicleNumber}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>경로</Text><Text style={styles.summaryVal}>{lastCompletion.route}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>출발/도착</Text><Text style={styles.summaryVal}>{lastCompletion.startTime} / {lastCompletion.endTime}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>계기판 총 주행거리</Text><Text style={styles.summaryVal}>{lastCompletion.totalOdometer}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>계기판 운행거리</Text><Text style={styles.summaryVal}>{lastCompletion.tripDistance}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>실제 이동거리</Text><Text style={styles.summaryVal}>{lastCompletion.gpsDistance}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>소모 유류</Text><Text style={styles.summaryVal}>{lastCompletion.fuelUsed}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>운행목적</Text><Text style={styles.summaryVal}>{lastCompletion.purpose}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>운행자</Text><Text style={styles.summaryVal}>{lastCompletion.operator}</Text></View>
            <View style={styles.summaryLine}><Text style={styles.summaryKey}>사용자</Text><Text style={styles.summaryVal}>{lastCompletion.user}</Text></View>
          </View>
          <Pressable style={styles.startBtn} onPress={() => setLastCompletion(null)}>
            <Text style={styles.startBtnText}>새 운행 입력</Text>
          </Pressable>
        </View>
      ) : (
        <>
        <View style={styles.heroCard}>
          <View>
            <Text style={styles.kicker}>오늘 운행</Text>
            <Text style={styles.heroTitle}>출발 준비</Text>
          </View>
          <View style={styles.heroIconBox}>
            <Text style={styles.heroIcon}>▶</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <View style={styles.compactHeader}>
            <Text style={styles.formTitle}>차량</Text>
            <Text style={styles.compactMeta}>계기판 {formatKm(selectedCurrentKm)}</Text>
          </View>
          <VehicleDropdown vehicles={vehicles} selectedVehicleId={selectedVehicleId} onSelect={setSelectedVehicleId} compact />
          <View style={styles.compactStatus}>
            <Text style={styles.obdStripLabel}>OBD</Text>
            <Text style={styles.obdStripValue}>{obdLabel}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>인원</Text>
          <View style={styles.twoCol}>
            <TextInput style={styles.halfInput} value={operatorRank} onChangeText={setOperatorRank} placeholder="운행자 계급" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.halfInput} value={operatorName} onChangeText={setOperatorName} placeholder="운행자 성명" placeholderTextColor="#94A3B8" />
          </View>

          <Pressable style={styles.checkRow} onPress={() => setSameUser((current) => !current)}>
            <View style={[styles.checkbox, sameUser && styles.checkboxOn]}>
              <Text style={styles.checkboxText}>{sameUser ? '✓' : ''}</Text>
            </View>
            <Text style={styles.checkText}>사용자도 운행자와 동일</Text>
          </Pressable>

          <View style={styles.twoCol}>
            <TextInput
              style={styles.halfInput}
              value={userRank}
              onChangeText={setUserRank}
              placeholder="사용자 계급"
              placeholderTextColor="#94A3B8"
              editable={!sameUser}
            />
            <TextInput
              style={styles.halfInput}
              value={userName}
              onChangeText={setUserName}
              placeholder="사용자 성명"
              placeholderTextColor="#94A3B8"
              editable={!sameUser}
            />
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>운행 정보</Text>
          <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="운행 목적" placeholderTextColor="#94A3B8" />
          <View style={styles.twoCol}>
            <TextInput style={styles.halfInput} value={startPlace} onChangeText={setStartPlace} placeholder="출발지" placeholderTextColor="#94A3B8" />
            <TextInput style={styles.halfInput} value={endPlace} onChangeText={setEndPlace} placeholder="목적지" placeholderTextColor="#94A3B8" />
          </View>
          <TextInput
            style={styles.input}
            value={startOdometer}
            onChangeText={setStartOdometer}
            placeholder="출발 계기판 km"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
          />
        </View>

        <Pressable style={styles.startBtn} onPress={handlePrimaryAction} disabled={isSaving}>
          <Text style={styles.startBtnText}>{isSaving ? '저장 중' : '운행 시작'}</Text>
        </Pressable>
        </>
      )}
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  driverScreen: {
    flex: 1,
    backgroundColor: '#F0F4FB',
    paddingHorizontal: 18,
  },
  driverTitle: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  heroCard: {
    minHeight: 96,
    borderRadius: 20,
    backgroundColor: '#1D2B5C',
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  kicker: { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 5 },
  heroTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  activeTitle: { color: '#0F172A', fontSize: 34, fontWeight: '700' },
  heroIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIcon: { color: '#2563EB', fontSize: 22, fontWeight: '700' },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    padding: 12,
    marginBottom: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  compactHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  formTitle: { color: '#0F172A', fontSize: 15, fontWeight: '700' },
  compactMeta: { color: '#64748B', fontSize: 11, fontWeight: '500' },
  tripCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F8',
    padding: 14,
    marginBottom: 6,
  },
  tripCardActive: {
    minHeight: Math.max(720, SCREEN_HEIGHT - 72),
    justifyContent: 'flex-start',
  },
  tripCardFullscreen: {
    flex: 1,
    marginBottom: 0,
    padding: 22,
  },
  tripFlexibleSpace: { minHeight: 18 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ECFDF3',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A' },
  liveBadgeText: { color: '#047857', fontSize: 11, fontWeight: '700' },
  routePanel: {
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: '#F5F8FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  routePoint: { color: '#0F172A', fontSize: 18, fontWeight: '700', flex: 1 },
  routeArrow: { color: '#94A3B8', fontSize: 20, fontWeight: '400', marginHorizontal: 12 },
  liveInfoRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  liveInfoCard: {
    flex: 1,
    minHeight: 74,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  liveInfoLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', marginBottom: 8 },
  liveInfoValue: { color: '#0F172A', fontSize: 16, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: { flex: 1, minHeight: 116, borderRadius: 14, backgroundColor: '#F5F8FF', padding: 16, justifyContent: 'center' },
  statLabel: { color: '#64748B', fontSize: 13, fontWeight: '600', marginBottom: 10 },
  statValue: { color: '#0F172A', fontSize: 18, fontWeight: '700' },
  obdStrip: {
    minHeight: 78,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginTop: 2,
  },
  compactStatus: {
    minHeight: 34,
    borderRadius: 13,
    backgroundColor: '#EFF6FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 11,
    marginTop: 7,
  },
  autoOdoBox: {
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: '#F5F8FF',
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginTop: 12,
    justifyContent: 'center',
  },
  autoOdoLabel: { color: '#64748B', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  autoOdoValue: { color: '#0F172A', fontSize: 17, fontWeight: '700' },
  thanksCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#F0FDF8',
    borderWidth: 1,
    borderColor: '#CFF4E3',
    padding: 18,
    marginBottom: 14,
    justifyContent: 'space-between',
  },
  thanksTitle: { color: '#047857', fontSize: 22, fontWeight: '700' },
  thanksSub: { color: '#588674', fontSize: 14, fontWeight: '600', marginTop: 6, marginBottom: 12 },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#DDF7EB',
    minHeight: 46,
    paddingTop: 10,
    marginTop: 8,
  },
  summaryKey: { color: '#588674', fontSize: 13, fontWeight: '600', flexShrink: 0 },
  summaryVal: { color: '#163B31', fontSize: 14, fontWeight: '700', flex: 1, textAlign: 'right' },
  obdStripLabel: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  obdStripValue: { color: '#1D4ED8', fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  input: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F4',
    backgroundColor: '#F5F8FF',
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '500',
    paddingHorizontal: 12,
    marginTop: 6,
  },
  twoCol: { flexDirection: 'row', gap: 8, marginTop: 6 },
  halfInput: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F4',
    backgroundColor: '#F5F8FF',
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '500',
    paddingHorizontal: 12,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  checkboxText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  checkText: { color: '#64748B', fontSize: 13, fontWeight: '500' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
  cancelBtnWide: {
    flex: 0.7,
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  cancelBtnText: { color: '#DC2626', fontSize: 16, fontWeight: '600' },
  endBtn: {
    flex: 1.4,
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: '#128A7A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  endBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  startBtn: {
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
    marginTop: 0,
  },
  startBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  completionWrap: { minHeight: Math.max(720, SCREEN_HEIGHT - 72), justifyContent: 'space-between' },
  completionFullscreen: { flex: 1, justifyContent: 'space-between', gap: 14 },
});
