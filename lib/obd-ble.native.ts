import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, type Subscription } from 'react-native-ble-plx';

// ELM327 BLE 어댑터 서비스/특성 프로파일
const BLE_PROFILES = [
  {
    name: 'FFE0/FFE1 (Vgate iCar Pro / HM-10)',
    serviceUUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
    writeUUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
    notifyUUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'FFF0/FFF1/FFF2',
    serviceUUID: '0000fff0-0000-1000-8000-00805f9b34fb',
    writeUUID: '0000fff2-0000-1000-8000-00805f9b34fb',
    notifyUUID: '0000fff1-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'Nordic UART',
    serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    writeUUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    notifyUUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  },
] as const;

const INIT_COMMANDS = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0', 'ATAT2'] as const;
const COMMAND_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 2000;

export type ObdLiveData = {
  speedKmh: number | null;
  rpm: number | null;
  coolantTempC: number | null;
  batteryVoltage: number | null;
  fuelLevelPercent: number | null;
  engineLoadPercent: number | null;
  throttlePercent: number | null;
  intakeAirTempC: number | null;
  dtcCodes: string[];
  ignitionOn: boolean;
  recordedAt: string;
};

export type ObdDevice = { id: string; name: string; rssi: number | null };

export type ObdConnectionState =
  | 'idle' | 'scanning' | 'connecting' | 'initializing' | 'connected' | 'error' | 'disconnected';

export type ObdCallbacks = {
  onStateChange: (state: ObdConnectionState, message?: string) => void;
  onDeviceFound: (device: ObdDevice) => void;
  onData: (data: ObdLiveData) => void;
};

function b64encode(str: string): string {
  return btoa(str);
}

function b64decode(b64: string): string {
  try { return atob(b64); } catch { return ''; }
}

function parseObdBytes(pid: string, response: string): number[] | null {
  const upper = response.toUpperCase().replace(/\s/g, '');
  const marker = `41${pid.toUpperCase()}`;
  const idx = upper.indexOf(marker);
  if (idx === -1) return null;
  const hex = upper.slice(idx + marker.length);
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if (!isNaN(b)) bytes.push(b);
  }
  return bytes;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

class ObdBleService {
  private _manager: BleManager | null = null;
  private get manager(): BleManager {
    if (!this._manager) this._manager = new BleManager();
    return this._manager;
  }
  private device: Device | null = null;
  private serviceUUID = '';
  private writeUUID = '';
  private notifyUUID = '';
  private notifySubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private responseBuffer = '';
  private pendingResolve: ((s: string) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: ObdCallbacks | null = null;
  private scanningActive = false;
  private liveData: ObdLiveData = {
    speedKmh: null, rpm: null, coolantTempC: null,
    batteryVoltage: null, fuelLevelPercent: null,
    engineLoadPercent: null, throttlePercent: null, intakeAirTempC: null,
    dtcCodes: [], ignitionOn: false, recordedAt: new Date().toISOString(),
  };

  setCallbacks(cb: ObdCallbacks) {
    this.callbacks = cb;
  }

  async checkBluetoothState(): Promise<boolean> {
    const state = await this.manager.state();
    return state === State.PoweredOn;
  }

  startScan() {
    this.scanningActive = true;
    this.callbacks?.onStateChange('scanning');
    const seen = new Set<string>();
    this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error || !device) return;
      const name = device.name ?? device.localName ?? '';
      if (!name || seen.has(device.id)) return;
      seen.add(device.id);
      this.callbacks?.onDeviceFound({ id: device.id, name, rssi: device.rssi });
    });
  }

  stopScan() {
    this.manager.stopDeviceScan();
    if (this.scanningActive) {
      this.scanningActive = false;
      this.callbacks?.onStateChange('idle');
    }
  }

  async connect(deviceId: string): Promise<void> {
    this.scanningActive = false;
    this.callbacks?.onStateChange('connecting', '단말기 연결 시도 중...');
    this.manager.stopDeviceScan();

    try {
      if (Platform.OS === 'android' && Platform.Version >= 31) {
        this.callbacks?.onStateChange('connecting', '블루투스 권한 확인 중...');
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        const allGranted = Object.values(granted).every(
          (r) => r === PermissionsAndroid.RESULTS.GRANTED
        );
        if (!allGranted) throw new Error('블루투스 권한이 필요합니다. 설정에서 허용해 주세요.');
      }

      this.callbacks?.onStateChange('connecting', 'BLE 연결 중... (최대 15초)');
      this.device = await this.manager.connectToDevice(deviceId, { timeout: 15000 });

      this.callbacks?.onStateChange('connecting', '서비스 검색 중...');
      await sleep(300);
      await this.device.discoverAllServicesAndCharacteristics();

      this.callbacks?.onStateChange('connecting', '프로파일 확인 중...');
      const matched = await this.detectProfile();
      if (!matched) {
        const services = await this.device.services();
        const uuids = services.map((s) => s.uuid.slice(4, 8).toUpperCase()).join(', ');
        throw new Error(`ELM327 프로파일 없음\n발견된 서비스: [${uuids || '없음'}]\n제조사 고객센터에 BLE 서비스 UUID 문의 필요`);
      }
    } catch (err) {
      this.cleanup();
      if (this.device) {
        await this.device.cancelConnection().catch(() => {});
        this.device = null;
      }
      const msg = err instanceof Error ? err.message : '연결 실패';
      this.callbacks?.onStateChange('error', msg);
      throw err;
    }

    this.disconnectSubscription = this.device.onDisconnected(() => {
      this.cleanup();
      this.callbacks?.onStateChange('disconnected', '단말기 연결이 끊겼습니다.');
    });

    this.notifySubscription = this.device.monitorCharacteristicForService(
      this.serviceUUID, this.notifyUUID,
      (_err, char) => { if (char?.value) this.onResponse(b64decode(char.value)); }
    );

    this.callbacks?.onStateChange('initializing');
    for (const cmd of INIT_COMMANDS) {
      await this.sendCommand(cmd);
      await sleep(300);
    }
    this.callbacks?.onStateChange('connected');
    this.startPolling();
  }

  private async detectProfile(): Promise<boolean> {
    if (!this.device) return false;
    const services = await this.device.services();
    const svcUuids = services.map((s) => s.uuid.toLowerCase());

    for (const profile of BLE_PROFILES) {
      if (!svcUuids.includes(profile.serviceUUID)) continue;
      const svc = services.find((s) => s.uuid.toLowerCase() === profile.serviceUUID)!;
      const chars = await svc.characteristics();
      const charUuids = chars.map((c) => c.uuid.toLowerCase());
      if (charUuids.includes(profile.writeUUID) && charUuids.includes(profile.notifyUUID)) {
        this.serviceUUID = profile.serviceUUID;
        this.writeUUID = profile.writeUUID;
        this.notifyUUID = profile.notifyUUID;
        return true;
      }
    }
    return false;
  }

  private onResponse(text: string) {
    this.responseBuffer += text;
    if (this.responseBuffer.includes('>')) {
      const response = this.responseBuffer.replace(/>/g, '').replace(/\r/g, '').trim();
      this.responseBuffer = '';
      if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve?.(response);
    }
  }

  private sendCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.device) return reject(new Error('연결 안 됨'));
      this.pendingResolve = resolve;
      this.responseBuffer = '';
      this.pendingTimer = setTimeout(() => {
        this.pendingResolve = null;
        resolve('TIMEOUT');
      }, COMMAND_TIMEOUT_MS);
      this.device
        .writeCharacteristicWithoutResponseForService(this.serviceUUID, this.writeUUID, b64encode(cmd + '\r'))
        .catch(reject);
    });
  }

  private startPolling() {
    const poll = async () => {
      if (!this.device) return;
      try {
        // 차속
        const speedR = await this.sendCommand('010D');
        const speedB = parseObdBytes('0D', speedR);
        if (speedB) this.liveData.speedKmh = speedB[0] ?? null;

        // RPM
        const rpmR = await this.sendCommand('010C');
        const rpmB = parseObdBytes('0C', rpmR);
        if (rpmB && rpmB.length >= 2) this.liveData.rpm = Math.round((rpmB[0] * 256 + rpmB[1]) / 4);

        // 냉각수 온도
        const coolR = await this.sendCommand('0105');
        const coolB = parseObdBytes('05', coolR);
        if (coolB) this.liveData.coolantTempC = (coolB[0] ?? 40) - 40;

        // 연료 레벨
        const fuelR = await this.sendCommand('012F');
        const fuelB = parseObdBytes('2F', fuelR);
        if (fuelB) this.liveData.fuelLevelPercent = Math.round((fuelB[0] ?? 0) * 100 / 255);

        // 배터리 전압 (ATRV 명령)
        const voltR = await this.sendCommand('ATRV');
        const voltMatch = voltR.match(/(\d+\.?\d*)\s*[Vv]/);
        if (voltMatch) this.liveData.batteryVoltage = parseFloat(parseFloat(voltMatch[1]).toFixed(1));

        // 엔진 부하 (0104)
        const loadR = await this.sendCommand('0104');
        const loadB = parseObdBytes('04', loadR);
        if (loadB) this.liveData.engineLoadPercent = Math.round((loadB[0] ?? 0) * 100 / 255);

        // 스로틀 개도 (0111)
        const tpsR = await this.sendCommand('0111');
        const tpsB = parseObdBytes('11', tpsR);
        if (tpsB) this.liveData.throttlePercent = Math.round((tpsB[0] ?? 0) * 100 / 255);

        // 흡기 온도 (010F)
        const iatR = await this.sendCommand('010F');
        const iatB = parseObdBytes('0F', iatR);
        if (iatB) this.liveData.intakeAirTempC = (iatB[0] ?? 40) - 40;

        this.liveData.ignitionOn = true;
        this.liveData.recordedAt = new Date().toISOString();
        this.callbacks?.onData({ ...this.liveData });
      } catch {
        // 일시적 오류 무시
      }
    };

    poll();
    this.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  async readOdometerKm(): Promise<number | null> {
    try {
      const response = await this.sendCommand('01A6');
      const bytes = parseObdBytes('A6', response);
      if (!bytes || bytes.length < 4) return null;
      const km = (bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3]) / 10;
      return km;
    } catch {
      return null;
    }
  }

  async readFuelSnapshot(): Promise<number | null> {
    try {
      const response = await this.sendCommand('012F');
      const bytes = parseObdBytes('2F', response);
      if (!bytes || bytes.length < 1) return null;
      return Math.round((bytes[0] * 100) / 255);
    } catch {
      return null;
    }
  }

  async readDtcCodes(): Promise<void> {
    try {
      const response = await this.sendCommand('03');
      if (!response || response === 'TIMEOUT' || response.includes('NO DATA')) {
        this.liveData = { ...this.liveData, dtcCodes: [] };
        this.callbacks?.onData({ ...this.liveData });
        return;
      }
      const hex = response.replace(/\s/g, '').toUpperCase().replace(/^43/, '');
      const codes: string[] = [];
      for (let i = 0; i + 3 < hex.length; i += 4) {
        const raw = parseInt(hex.slice(i, i + 4), 16);
        if (raw === 0 || isNaN(raw)) continue;
        const prefix = ['P', 'C', 'B', 'U'][(raw >> 14) & 0x03];
        codes.push(`${prefix}${String(raw & 0x3fff).padStart(4, '0')}`);
      }
      this.liveData = { ...this.liveData, dtcCodes: codes };
      this.callbacks?.onData({ ...this.liveData });
    } catch {
      // 읽기 실패 시 무시
    }
  }

  async disconnect(): Promise<void> {
    this.cleanup();
    const dev = this.device;
    this.device = null;
    await dev?.cancelConnection().catch(() => {});
    this.callbacks?.onStateChange('idle');
  }

  private cleanup() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    this.pendingResolve = null;
    this.notifySubscription?.remove();
    this.notifySubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }
}

export const obdBle = new ObdBleService();
