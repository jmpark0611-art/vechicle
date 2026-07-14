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
  summary: string;
};

const SELECTED_DEVICE_KEY = 'vehicle-obd-ble-selected-device-v1';
const DEFAULT_SCAN_MS = 8_000;

// Known BLE OBD serial profiles (service / notify / write characteristic prefixes)
const OBD_BLE_PROFILES = [
  { name: 'HM-10 / Vgate iCar BLE (FFE0)', servicePrefix: 'FFE0',     notifyPrefix: 'FFE1',     writePrefix: 'FFE1' },
  { name: 'Generic OBD BLE (FFF0)',         servicePrefix: 'FFF0',     notifyPrefix: 'FFF1',     writePrefix: 'FFF2' },
  { name: 'Nordic UART Service',            servicePrefix: '6E400001', notifyPrefix: '6E400003', writePrefix: '6E400002' },
  // IOS-Vlink / Veepeak BLE — service 18F0, chars 2AF0(write) + 2AF1(notify)
  { name: 'IOS-Vlink / Veepeak (18F0)',     servicePrefix: '18F0',     notifyPrefix: '2AF1',     writePrefix: '2AF0' },
  // Vlink custom service starting with E7810A71
  { name: 'Vlink Custom (E7810A71)',         servicePrefix: 'E7810A71', notifyPrefix: 'BEF8D6C9', writePrefix: 'BEF8D6C9' },
];

function uuidMatches(uuid: string, prefix: string): boolean {
  const u = uuid.toUpperCase().replace(/-/g, '');
  const p = prefix.toUpperCase().replace(/-/g, '');
  // Match short-form (e.g. "FFE0" inside "0000FFE0-...") or long-form prefix
  return u.startsWith(p) || u.includes(p.slice(0, 8));
}

function decodeB64(b64: string): string {
  try { return atob(b64); } catch { return ''; }
}

function encodeB64(str: string): string {
  try { return btoa(str); } catch { return ''; }
}

// Parse RPM from ELM327 response to PID 010C  →  41 0C xx yy  →  (xx*256+yy)/4
function parseRpm(response: string): number | null {
  const m = response.replace(/\s/g, '').match(/410C([0-9A-Fa-f]{4})/i);
  if (!m) return null;
  return Math.round(parseInt(m[1], 16) / 4);
}

// Parse speed from PID 010D  →  41 0D xx  →  xx km/h
function parseSpeed(response: string): number | null {
  const m = response.replace(/\s/g, '').match(/410D([0-9A-Fa-f]{2})/i);
  if (!m) return null;
  return parseInt(m[1], 16);
}

function deviceName(device: { name?: string | null; localName?: string | null }) {
  return device.localName || device.name || '이름 없는 BLE 장치';
}

function isLikelyObdDevice(device: { name?: string | null; localName?: string | null; serviceUUIDs?: string[] | null }) {
  const name = deviceName(device).toLowerCase();
  const serviceText = (device.serviceUUIDs ?? []).join(' ').toLowerCase();
  return /obd|elm|vlink|v-link|icar|car|ble|uart|ffe0|fff0/.test(`${name} ${serviceText}`);
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
          name: deviceName(device),
          rssi: typeof device.rssi === 'number' ? device.rssi : null,
          serviceUUIDs: device.serviceUUIDs ?? [],
        });
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
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSelectedObdBleDevice(device: ObdBleDevice) {
  await AsyncStorage.setItem(SELECTED_DEVICE_KEY, JSON.stringify(device));
}

/**
 * Connect to a BLE OBD device, auto-detect the serial profile (FFE0 / FFF0 / Nordic UART),
 * run an ELM327 AT-command init sequence, and probe RPM + speed PIDs.
 *
 * One-shot: creates and destroys the BleManager internally.
 * The device is disconnected on return (success or failure).
 */
export async function probeElm327Connection(deviceId: string): Promise<ObdProbeResult> {
  const logs: ObdProbeLog[] = [];
  let rpm: number | null = null;
  let speedKmh: number | null = null;
  let matchedProfileName: string | null = null;

  const hasPermission = await requestAndroidBluetoothPermissions();
  if (!hasPermission) {
    return {
      ok: false,
      profile: null,
      logs: [{ step: 'Bluetooth 권한', ok: false, detail: '권한이 허용되지 않았습니다.' }],
      rpm: null,
      speedKmh: null,
      summary: 'Bluetooth 권한 필요',
    };
  }

  const { BleManager } = await import('react-native-ble-plx');
  const manager = new BleManager();

  try {
    const btState = await manager.state();
    if (btState !== 'PoweredOn') {
      return {
        ok: false,
        profile: null,
        logs: [{ step: 'Bluetooth 상태', ok: false, detail: `${btState} — Bluetooth를 켜 주세요` }],
        rpm: null,
        speedKmh: null,
        summary: 'Bluetooth 꺼짐',
      };
    }
    logs.push({ step: 'Bluetooth 상태', ok: true, detail: 'PoweredOn' });

    // Connect
    logs.push({ step: '연결 시도', ok: true, detail: deviceId.slice(0, 24) });
    const device = await manager.connectToDevice(deviceId, { autoConnect: false });
    logs.push({ step: '연결됨', ok: true });

    // Discover services and characteristics
    await device.discoverAllServicesAndCharacteristics();
    const services = await device.services();
    logs.push({
      step: '서비스 검색',
      ok: true,
      detail: services.map((s) => s.uuid.toUpperCase().slice(0, 8)).join(' / '),
    });

    // Find a matching OBD BLE profile
    type BleChar = Awaited<ReturnType<(typeof services)[0]['characteristics']>>[0];
    let notifyChar: BleChar | null = null;
    let writeChar: BleChar | null = null;

    outer: for (const profile of OBD_BLE_PROFILES) {
      const svc = services.find((s) => uuidMatches(s.uuid, profile.servicePrefix));
      if (!svc) continue;

      const chars = await svc.characteristics();
      const notify = chars.find((c) => uuidMatches(c.uuid, profile.notifyPrefix) && c.isNotifiable);
      const write = chars.find(
        (c) =>
          uuidMatches(c.uuid, profile.writePrefix) &&
          (c.isWritableWithResponse || c.isWritableWithoutResponse)
      );

      if (notify && write) {
        matchedProfileName = profile.name;
        notifyChar = notify;
        writeChar = write;
        logs.push({ step: 'BLE 프로필 매칭', ok: true, detail: profile.name });
        break outer;
      }
    }

    // Auto-discover fallback: scan every non-standard service for a notifiable + writable characteristic pair
    if (!notifyChar || !writeChar) {
      const STANDARD_PREFIXES = ['1800', '1801', '1802', '1803', '1804', '1805', '1806', '1807',
                                  '1808', '1809', '180A', '180B', '180C', '180D', '180E', '180F'];
      const nonStdServices = services.filter(
        (s) => !STANDARD_PREFIXES.some((p) => uuidMatches(s.uuid, p))
      );

      for (const svc of nonStdServices) {
        const chars = await svc.characteristics();
        const allUUIDs = chars.map((c) => c.uuid.toUpperCase().slice(0, 8)).join(' / ');
        logs.push({ step: `자동탐색 서비스 ${svc.uuid.toUpperCase().slice(0, 8)}`, ok: true, detail: allUUIDs });

        // Prefer a single char that is both notifiable and writable (common in cheap adapters)
        const dual = chars.find(
          (c) => c.isNotifiable && (c.isWritableWithResponse || c.isWritableWithoutResponse)
        );
        if (dual) {
          matchedProfileName = `자동탐색 — ${svc.uuid.toUpperCase().slice(0, 8)} / ${dual.uuid.toUpperCase().slice(0, 8)}`;
          notifyChar = dual;
          writeChar = dual;
          logs.push({ step: 'BLE 프로필 자동탐색', ok: true, detail: matchedProfileName });
          break;
        }

        // Try separate notify + write characteristics
        const notify = chars.find((c) => c.isNotifiable);
        const write = chars.find((c) => c.isWritableWithResponse || c.isWritableWithoutResponse);
        if (notify && write) {
          matchedProfileName = `자동탐색 — ${svc.uuid.toUpperCase().slice(0, 8)}`;
          notifyChar = notify;
          writeChar = write;
          logs.push({ step: 'BLE 프로필 자동탐색', ok: true, detail: matchedProfileName });
          break;
        }
      }
    }

    if (!notifyChar || !writeChar) {
      logs.push({
        step: 'BLE 프로필 매칭',
        ok: false,
        detail: '알려진 프로필과 자동탐색 모두 실패했습니다. 서비스 UUID를 개발자에게 공유해 주세요.',
      });
      return { ok: false, profile: null, logs, rpm: null, speedKmh: null, summary: '호환 BLE 프로필 없음' };
    }

    // Buffer incoming notify chunks; resolve when ELM327 prompt '>' arrives
    let rxBuffer = '';
    let rxResolve: ((s: string) => void) | null = null;

    const subscription = notifyChar.monitor((error, char) => {
      if (error || !char?.value) return;
      rxBuffer += decodeB64(char.value);
      if (rxBuffer.includes('>') && rxResolve) {
        const response = rxBuffer;
        rxBuffer = '';
        const resolve = rxResolve;
        rxResolve = null;
        resolve(response);
      }
    });

    const capturedWrite = writeChar;

    async function sendCmd(cmd: string, timeoutMs = 4000): Promise<string> {
      rxBuffer = '';
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          rxResolve = null;
          reject(new Error('응답 시간 초과'));
        }, timeoutMs);

        rxResolve = (response: string) => {
          clearTimeout(timer);
          resolve(response);
        };

        const encoded = encodeB64(cmd + '\r');
        const writeOp = capturedWrite.isWritableWithResponse
          ? capturedWrite.writeWithResponse(encoded)
          : capturedWrite.writeWithoutResponse(encoded);

        writeOp.catch((err: Error) => {
          clearTimeout(timer);
          rxResolve = null;
          reject(err);
        });
      });
    }

    try {
      // ATZ — reset ELM327 (slow, allow 5 s)
      const atzResp = await sendCmd('ATZ', 5000);
      logs.push({
        step: 'ATZ (리셋)',
        ok: atzResp.includes('>'),
        detail: atzResp.replace(/\r\n/g, ' ').trim().slice(0, 60),
      });

      // Echo off
      const ate0Resp = await sendCmd('ATE0');
      logs.push({
        step: 'ATE0 (에코 끔)',
        ok: ate0Resp.includes('OK') || ate0Resp.includes('>'),
        detail: ate0Resp.trim().slice(0, 40),
      });

      // Linefeeds off, spaces off
      await sendCmd('ATL0');
      await sendCmd('ATS0');
      logs.push({ step: 'ATL0/ATS0 (포맷)', ok: true });

      // Auto OBD protocol
      const atspResp = await sendCmd('ATSP0');
      logs.push({
        step: 'ATSP0 (자동 프로토콜)',
        ok: atspResp.includes('OK') || atspResp.includes('>'),
        detail: atspResp.trim().slice(0, 40),
      });

      // PID 010C — RPM
      try {
        const rpmResp = await sendCmd('010C', 6000);
        rpm = parseRpm(rpmResp);
        logs.push({
          step: 'RPM (010C)',
          ok: rpm !== null,
          detail: `${rpmResp.replace(/\r/g, ' ').trim().slice(0, 40)} → ${rpm !== null ? `${rpm} RPM` : '파싱 실패'}`,
        });
      } catch (e) {
        logs.push({ step: 'RPM (010C)', ok: false, detail: e instanceof Error ? e.message : '오류' });
      }

      // PID 010D — speed
      try {
        const speedResp = await sendCmd('010D', 6000);
        speedKmh = parseSpeed(speedResp);
        logs.push({
          step: '속도 (010D)',
          ok: speedKmh !== null,
          detail: `${speedResp.replace(/\r/g, ' ').trim().slice(0, 40)} → ${speedKmh !== null ? `${speedKmh} km/h` : '파싱 실패'}`,
        });
      } catch (e) {
        logs.push({ step: '속도 (010D)', ok: false, detail: e instanceof Error ? e.message : '오류' });
      }
    } finally {
      subscription.remove();
    }

    const success = rpm !== null || speedKmh !== null || matchedProfileName !== null;
    const hasData = rpm !== null || speedKmh !== null;
    return {
      ok: success,
      profile: matchedProfileName,
      logs,
      rpm,
      speedKmh,
      summary: hasData
        ? `${matchedProfileName} · RPM ${rpm ?? '-'} · ${speedKmh ?? '-'} km/h`
        : matchedProfileName
          ? `${matchedProfileName} 연결됨 · OBD 데이터 없음 (엔진 시동 후 재시도)`
          : '연결 실패',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logs.push({ step: '연결 오류', ok: false, detail });
    return {
      ok: false,
      profile: matchedProfileName,
      logs,
      rpm: null,
      speedKmh: null,
      summary: `연결 실패: ${detail}`,
    };
  } finally {
    try { manager.destroy(); } catch { /* ignore */ }
  }
}
