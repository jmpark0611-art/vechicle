import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';

export type ObdBleDevice = {
  id: string;
  name: string;
  rssi: number | null;
  serviceUUIDs: string[];
};

export type ObdBleScanResult = {
  ok: boolean;
  message: string;
  devices: ObdBleDevice[];
};

const SELECTED_DEVICE_KEY = 'vehicle-obd-ble-selected-device-v1';
const DEFAULT_SCAN_MS = 3_000;
const DEVICE_ALIASES: Record<string, string> = {
  '7E:57:58:E1:03:3D': '1862-Test',
};

function deviceName(device: { name?: string | null; localName?: string | null }) {
  return device.localName || device.name || '이름 없는 BLE 장치';
}

function applyDeviceAlias(device: ObdBleDevice): ObdBleDevice {
  const alias = DEVICE_ALIASES[device.id];
  return alias ? { ...device, name: alias } : device;
}

export function getVehicleNumberForObdDevice(device: ObdBleDevice | null | undefined): string | null {
  if (!device) return null;
  return DEVICE_ALIASES[device.id] ?? null;
}

function isLikelyObdDevice(device: { name?: string | null; localName?: string | null; serviceUUIDs?: string[] | null }) {
  const name = deviceName(device).toLowerCase();
  const serviceText = (device.serviceUUIDs ?? []).join(' ').toLowerCase();
  return /obd|elm|vlink|v-link|icar|car|ble|uart|ffe0|fff0/.test(`${name} ${serviceText}`);
}

function isStrongObdDevice(device: { name?: string | null; localName?: string | null; serviceUUIDs?: string[] | null }) {
  const name = deviceName(device).toLowerCase();
  const serviceText = (device.serviceUUIDs ?? []).join(' ').toLowerCase();
  return /obd|elm|vlink|v-link|icar|ffe0|fff0|18f0|e7810a71|6e400001/.test(`${name} ${serviceText}`);
}

async function requestAndroidBluetoothPermissions() {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions: string[] = [];
  const version = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);

  if (version >= 31) {
    permissions.push('android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT');
  } else {
    permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }

  const result = await PermissionsAndroid.requestMultiple(permissions as Parameters<typeof PermissionsAndroid.requestMultiple>[0]);
  return Object.values(result).every((value) => value === PermissionsAndroid.RESULTS.GRANTED);
}

export async function scanForObdBleDevices(scanMs = DEFAULT_SCAN_MS): Promise<ObdBleScanResult> {
  if (Platform.OS === 'web') {
    return { ok: false, message: '웹 데모에서는 Bluetooth 검색을 사용할 수 없습니다.', devices: [] };
  }

  const hasPermission = await requestAndroidBluetoothPermissions();
  if (!hasPermission) {
    return { ok: false, message: 'Bluetooth 권한이 허용되지 않았습니다.', devices: [] };
  }

  const { BleManager } = await import('react-native-ble-plx');
  const manager = new BleManager();
  const found = new Map<string, ObdBleDevice>();

  try {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      return { ok: false, message: `Bluetooth 상태가 ${state}입니다. 휴대폰 Bluetooth를 켜 주세요.`, devices: [] };
    }

    await new Promise<void>((resolve) => {
      const timeoutId = setTimeout(() => {
        manager.stopDeviceScan();
        resolve();
      }, scanMs);

      manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (error) {
          clearTimeout(timeoutId);
          manager.stopDeviceScan();
          resolve();
          return;
        }

        if (!device || !isLikelyObdDevice(device)) {
          return;
        }

        found.set(device.id, {
          id: device.id,
          name: DEVICE_ALIASES[device.id] ?? deviceName(device),
          rssi: typeof device.rssi === 'number' ? device.rssi : null,
          serviceUUIDs: device.serviceUUIDs ?? [],
        });
        if (isStrongObdDevice(device)) {
          clearTimeout(timeoutId);
          manager.stopDeviceScan();
          resolve();
        }
      });
    });
  } finally {
    manager.destroy();
  }

  const devices = Array.from(found.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  return {
    ok: true,
    message:
      devices.length > 0
        ? `${devices.length}개 BLE OBD 후보를 찾았습니다.`
        : 'BLE OBD 후보를 찾지 못했습니다. 구형 ELM327 Classic Bluetooth 모델은 BLE 검색에 표시되지 않을 수 있습니다.',
    devices,
  };
}

export async function loadSelectedObdBleDevice(): Promise<ObdBleDevice | null> {
  const raw = await AsyncStorage.getItem(SELECTED_DEVICE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ObdBleDevice;
    if (!parsed.id || !parsed.name) {
      return null;
    }
    return applyDeviceAlias(parsed);
  } catch {
    return null;
  }
}

export async function saveSelectedObdBleDevice(device: ObdBleDevice) {
  await AsyncStorage.setItem(SELECTED_DEVICE_KEY, JSON.stringify(applyDeviceAlias(device)));
}

export type ObdProbeLog = {
  step: string;
  ok: boolean;
  detail?: string;
};

export type ObdProbeResult = {
  ok: boolean;
  profile: string | null;
  logs: ObdProbeLog[];
  rpm: number | null;
  speedKmh: number | null;
  coolantC: number | null;
  batteryV: number | null;
  summary: string;
};

export async function probeElm327Connection(_deviceId: string): Promise<ObdProbeResult> {
  return {
    ok: false,
    profile: null,
    logs: [{ step: 'ELM327 프로브', ok: false, detail: '웹 환경에서는 BLE 연결이 지원되지 않습니다.' }],
    rpm: null,
    speedKmh: null,
    coolantC: null,
    batteryV: null,
    summary: '웹 환경 미지원',
  };
}

export type ObdLiveData = {
  rpm: number | null;
  speedKmh: number | null;
  coolantC: number | null;
  batteryV: number | null;
  fuelPercent: number | null;
  intakeTempC: number | null;
  throttlePercent: number | null;
  engineLoadPercent: number | null;
  mapKpa: number | null;
  shortFuelTrimPercent: number | null;
  longFuelTrimPercent: number | null;
  oxygenSensorV: number | null;
  dtcCount: number | null;
  vin: string | null;
  readinessSummary: string | null;
  profile: string | null;
};

const EMPTY_LIVE: ObdLiveData = {
  rpm: null,
  speedKmh: null,
  coolantC: null,
  batteryV: null,
  fuelPercent: null,
  intakeTempC: null,
  throttlePercent: null,
  engineLoadPercent: null,
  mapKpa: null,
  shortFuelTrimPercent: null,
  longFuelTrimPercent: null,
  oxygenSensorV: null,
  dtcCount: null,
  vin: null,
  readinessSummary: null,
  profile: null,
};

type ObdCallbacksStub = {
  onData: (data: ObdLiveData) => void;
  onStatus: (msg: string) => void;
  onDisconnect: () => void;
};

class ObdBleConnectionStub {
  get isConnected(): boolean { return false; }
  get live(): ObdLiveData { return { ...EMPTY_LIVE }; }
  setCallbacks(_cbs: ObdCallbacksStub) {}
  async connect(_deviceId: string) { return { ok: false, profile: null as string | null, message: '웹 환경 미지원' }; }
  startPolling(_intervalMs?: number) {}
  stopPolling() {}
  async disconnect() {}
}

export const obdBle = new ObdBleConnectionStub();
