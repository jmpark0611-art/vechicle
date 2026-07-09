import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic, { BluetoothDevice, type BluetoothDeviceReadEvent } from 'react-native-bluetooth-classic';

const INIT_COMMANDS = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0', 'ATAT2'] as const;
const COMMAND_TIMEOUT_MS = 5000;
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

class ObdClassicService {
  private device: BluetoothDevice | null = null;
  private dataSubscription: { remove(): void } | null = null;
  private disconnectSubscription: { remove(): void } | null = null;
  private responseBuffer = '';
  private pendingResolve: ((s: string) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: ObdCallbacks | null = null;
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
    try {
      return await RNBluetoothClassic.isBluetoothEnabled();
    } catch {
      return false;
    }
  }

  async startScan() {
    this.callbacks?.onStateChange('scanning');
    try {
      if (Platform.Version >= 31) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
      }
      const paired = await RNBluetoothClassic.getBondedDevices();
      for (const d of paired) {
        this.callbacks?.onDeviceFound({
          id: d.address,
          name: d.name ?? d.address,
          rssi: null,
        });
      }
      if (paired.length === 0) {
        this.callbacks?.onStateChange('error', '페어링된 OBD 기기가 없습니다.\n설정 → 블루투스에서 "Android-Vlink"를 먼저 페어링하세요.');
      } else {
        this.callbacks?.onStateChange('idle');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '기기 목록 조회 실패';
      this.callbacks?.onStateChange('error', `페어링된 기기 조회 실패: ${msg}`);
    }
  }

  stopScan() {
    // Classic BT scan is one-shot (getBondedDevices), nothing to stop
  }

  async connect(deviceId: string): Promise<void> {
    this.callbacks?.onStateChange('connecting', '단말기 연결 시도 중...');

    try {
      if (Platform.Version >= 31) {
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

      this.callbacks?.onStateChange('connecting', 'SPP 연결 중... (최대 15초)');
      this.device = await RNBluetoothClassic.connectToDevice(deviceId, { delimiter: '>' });

      this.dataSubscription = this.device.onDataReceived((event: BluetoothDeviceReadEvent) => {
        this.onResponse(event.data ?? '');
      });

      this.disconnectSubscription = (RNBluetoothClassic as any).onDeviceDisconnected(() => {
        this.cleanup();
        this.device = null;
        this.callbacks?.onStateChange('disconnected', '단말기 연결이 끊겼습니다.');
      });

      this.callbacks?.onStateChange('initializing');
      for (const cmd of INIT_COMMANDS) {
        await this.sendCommand(cmd);
        await sleep(300);
      }
      this.callbacks?.onStateChange('connected');
      this.startPolling();
    } catch (err) {
      this.cleanup();
      if (this.device) {
        await this.device.disconnect().catch(() => {});
        this.device = null;
      }
      const msg = err instanceof Error ? err.message : '연결 실패';
      this.callbacks?.onStateChange('error', msg);
      throw err;
    }
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
      this.device.write(cmd + '\r').catch(reject);
    });
  }

  private startPolling() {
    const poll = async () => {
      if (!this.device) return;
      try {
        const speedR = await this.sendCommand('010D');
        const speedB = parseObdBytes('0D', speedR);
        if (speedB) this.liveData.speedKmh = speedB[0] ?? null;

        const rpmR = await this.sendCommand('010C');
        const rpmB = parseObdBytes('0C', rpmR);
        if (rpmB && rpmB.length >= 2) this.liveData.rpm = Math.round((rpmB[0] * 256 + rpmB[1]) / 4);

        const coolR = await this.sendCommand('0105');
        const coolB = parseObdBytes('05', coolR);
        if (coolB) this.liveData.coolantTempC = (coolB[0] ?? 40) - 40;

        const fuelR = await this.sendCommand('012F');
        const fuelB = parseObdBytes('2F', fuelR);
        if (fuelB) this.liveData.fuelLevelPercent = Math.round((fuelB[0] ?? 0) * 100 / 255);

        const voltR = await this.sendCommand('ATRV');
        const voltMatch = voltR.match(/(\d+\.?\d*)\s*[Vv]/);
        if (voltMatch) this.liveData.batteryVoltage = parseFloat(parseFloat(voltMatch[1]).toFixed(1));

        const loadR = await this.sendCommand('0104');
        const loadB = parseObdBytes('04', loadR);
        if (loadB) this.liveData.engineLoadPercent = Math.round((loadB[0] ?? 0) * 100 / 255);

        const tpsR = await this.sendCommand('0111');
        const tpsB = parseObdBytes('11', tpsR);
        if (tpsB) this.liveData.throttlePercent = Math.round((tpsB[0] ?? 0) * 100 / 255);

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
      return (bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3]) / 10;
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
    await dev?.disconnect().catch(() => {});
    this.callbacks?.onStateChange('idle');
  }

  private cleanup() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    this.pendingResolve = null;
    this.dataSubscription?.remove();
    this.dataSubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }
}

export const obdBle = new ObdClassicService();
