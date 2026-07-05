import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

// Vgate iCar Pro BLE 및 일반 ELM327 BLE 어댑터 UUID 패턴
// FFE0/FFE1: Vgate iCar Pro, OBDLINK CX 등 HM-10 기반 어댑터
// Nordic UART: 일부 ELM327 BLE 펌웨어
const BLE_PROFILES = [
  {
    name: 'FFE0/FFE1 (Vgate iCar Pro)',
    serviceUUID: '0000FFE0-0000-1000-8000-00805F9B34FB',
    writeUUID: '0000FFE1-0000-1000-8000-00805F9B34FB',
    notifyUUID: '0000FFE1-0000-1000-8000-00805F9B34FB',
  },
  {
    name: 'Nordic UART',
    serviceUUID: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
    writeUUID: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E',
    notifyUUID: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
  },
] as const;

// ELM327 초기화 시퀀스
const INIT_COMMANDS = [
  'ATZ',    // 리셋
  'ATE0',   // 에코 끄기
  'ATL0',   // 개행 끄기
  'ATS0',   // 공백 끄기
  'ATH0',   // 헤더 끄기
  'ATSP0',  // 프로토콜 자동 감지
  'ATAT2',  // 적응형 타이밍
] as const;

// OBD-II PID 목록
const PIDS = {
  SPEED: '010D',        // 차속 (km/h)
  RPM: '010C',          // 엔진 RPM
  COOLANT: '0105',      // 냉각수 온도 (°C)
  FUEL: '012F',         // 연료 레벨 (%)
  VOLTAGE: 'ATRV',      // 배터리 전압 (V)
  DTC: '03',            // 저장된 DTC 코드
} as const;

export type ObdLiveData = {
  speedKmh: number | null;
  rpm: number | null;
  coolantTempC: number | null;
  batteryVoltage: number | null;
  fuelLevelPercent: number | null;
  dtcCodes: string[];
  ignitionOn: boolean;
  recordedAt: string;
};

export type ObdDevice = {
  id: string;
  name: string;
  rssi: number | null;
};

export type ObdConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'initializing'
  | 'connected'
  | 'error'
  | 'disconnected';

export type ObdCallbacks = {
  onStateChange: (state: ObdConnectionState, message?: string) => void;
  onDeviceFound: (device: ObdDevice) => void;
  onData: (data: ObdLiveData) => void;
};

const COMMAND_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 2000;

class ObdBleService {
  private manager: BleManager;
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
  private liveData: ObdLiveData = {
    speedKmh: null,
    rpm: null,
    coolantTempC: null,
    batteryVoltage: null,
    fuelLevelPercent: null,
    dtcCodes: [],
    ignitionOn: false,
    recordedAt: new Date().toISOString(),
  };

  constructor() {
    this.manager = new BleManager();
  }

  setCallbacks(cb: ObdCallbacks) {
    this.callbacks = cb;
  }

  async checkBluetoothState(): Promise<boolean> {
    const state = await this.manager.state();
    return state === State.PoweredOn;
  }

  startScan() {
    if (!this.callbacks) return;
    this.callbacks.onStateChange('scanning');
    const seen = new Set<string>();

    this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error || !device) return;
      const name = device.name ?? device.localName ?? '';
      if (!name) return;
      if (seen.has(device.id)) return;
      seen.add(device.id);
      this.callbacks?.onDeviceFound({ id: device.id, name, rssi: device.rssi });
    });
  }

  stopScan() {
    this.manager.stopDeviceScan();
  }

  async connect(deviceId: string): Promise<void> {
    this.callbacks?.onStateChange('connecting');
    this.stopScan();

    this.device = await this.manager.connectToDevice(deviceId, {
      requestMTU: 512,
      timeout: 10000,
    });
    await this.device.discoverAllServicesAndCharacteristics();

    // 지원하는 BLE 프로파일 자동 감지
    const matched = await this.detectProfile();
    if (!matched) {
      throw new Error('ELM327 서비스를 찾을 수 없습니다. OBD 어댑터를 확인하세요.');
    }

    // 연결 해제 감지
    this.disconnectSubscription = this.device.onDisconnected(() => {
      this.cleanup();
      this.callbacks?.onStateChange('disconnected', '단말기 연결이 끊겼습니다.');
    });

    // 알림 구독 시작
    this.notifySubscription = this.device.monitorCharacteristicForService(
      this.serviceUUID,
      this.notifyUUID,
      (error, char) => {
        if (error || !char?.value) return;
        const decoded = Buffer.from(char.value, 'base64').toString('ascii');
        this.onResponse(decoded);
      }
    );

    // ELM327 초기화
    this.callbacks?.onStateChange('initializing');
    await this.initializeElm327();
    this.callbacks?.onStateChange('connected');

    // 주기적 데이터 폴링 시작
    this.startPolling();
  }

  private async detectProfile(): Promise<boolean> {
    if (!this.device) return false;
    const services = await this.device.services();

    for (const profile of BLE_PROFILES) {
      const svc = services.find(
        (s) => s.uuid.toUpperCase() === profile.serviceUUID.toUpperCase()
      );
      if (!svc) continue;

      const chars = await svc.characteristics();
      const hasWrite = chars.some(
        (c) => c.uuid.toUpperCase() === profile.writeUUID.toUpperCase() && c.isWritableWithResponse || c.isWritableWithoutResponse
      );
      const hasNotify = chars.some(
        (c) => c.uuid.toUpperCase() === profile.notifyUUID.toUpperCase() && c.isNotifiable
      );

      if (hasWrite && hasNotify) {
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

    // ELM327 프롬프트('>')가 오면 응답 완료
    if (this.responseBuffer.includes('>')) {
      const response = this.responseBuffer
        .replace(/>/g, '')
        .replace(/\r/g, '')
        .trim();
      this.responseBuffer = '';

      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }
      if (this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        resolve(response);
      }
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

      const encoded = Buffer.from(cmd + '\r').toString('base64');
      this.device
        .writeCharacteristicWithoutResponseForService(this.serviceUUID, this.writeUUID, encoded)
        .catch(reject);
    });
  }

  private async initializeElm327() {
    for (const cmd of INIT_COMMANDS) {
      await this.sendCommand(cmd);
      await sleep(300);
    }
  }

  private startPolling() {
    const poll = async () => {
      if (!this.device) return;
      try {
        await this.pollPid(PIDS.SPEED, this.parseSpeed.bind(this));
        await this.pollPid(PIDS.RPM, this.parseRpm.bind(this));
        await this.pollPid(PIDS.COOLANT, this.parseCoolant.bind(this));
        await this.pollPid(PIDS.FUEL, this.parseFuel.bind(this));
        await this.pollVoltage();

        this.liveData = {
          ...this.liveData,
          ignitionOn: true,
          recordedAt: new Date().toISOString(),
        };
        this.callbacks?.onData({ ...this.liveData });
      } catch {
        // 일시적 오류는 무시하고 계속 폴링
      }
    };

    poll();
    this.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  private async pollPid(pid: string, parser: (response: string) => void) {
    const response = await this.sendCommand(pid);
    if (response && response !== 'TIMEOUT' && !response.includes('NO DATA')) {
      parser(response);
    }
  }

  private async pollVoltage() {
    const response = await this.sendCommand(PIDS.VOLTAGE);
    if (response && response !== 'TIMEOUT') {
      const match = response.match(/(\d+\.?\d*)\s*V/i);
      if (match) {
        this.liveData.batteryVoltage = parseFloat(match[1]);
      }
    }
  }

  // OBD-II PID 응답 파싱
  private parseSpeed(response: string) {
    const bytes = parseObdResponse('0D', response);
    if (bytes && bytes.length >= 1) {
      this.liveData.speedKmh = bytes[0];
    }
  }

  private parseRpm(response: string) {
    const bytes = parseObdResponse('0C', response);
    if (bytes && bytes.length >= 2) {
      this.liveData.rpm = Math.round((bytes[0] * 256 + bytes[1]) / 4);
    }
  }

  private parseCoolant(response: string) {
    const bytes = parseObdResponse('05', response);
    if (bytes && bytes.length >= 1) {
      this.liveData.coolantTempC = bytes[0] - 40;
    }
  }

  private parseFuel(response: string) {
    const bytes = parseObdResponse('2F', response);
    if (bytes && bytes.length >= 1) {
      this.liveData.fuelLevelPercent = Math.round((bytes[0] * 100) / 255);
    }
  }

  async readDtcCodes(): Promise<string[]> {
    const response = await this.sendCommand(PIDS.DTC);
    if (!response || response === 'TIMEOUT' || response.includes('NO DATA')) return [];

    const codes: string[] = [];
    // 모드 43 응답: "43 01 33 00 00 00 00" 형식
    const hex = response.replace(/\s/g, '').toUpperCase();
    const data = hex.replace(/^43/, '');
    for (let i = 0; i + 3 < data.length; i += 4) {
      const raw = parseInt(data.slice(i, i + 4), 16);
      if (raw === 0) continue;
      const type = (raw >> 14) & 0x03;
      const prefix = ['P', 'C', 'B', 'U'][type];
      const code = `${prefix}${String(raw & 0x3fff).padStart(4, '0')}`;
      codes.push(code);
    }
    this.liveData.dtcCodes = codes;
    return codes;
  }

  async disconnect() {
    this.cleanup();
    if (this.device) {
      await this.device.cancelConnection().catch(() => {});
      this.device = null;
    }
    this.callbacks?.onStateChange('idle');
  }

  private cleanup() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.notifySubscription?.remove();
    this.notifySubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
    this.pendingResolve = null;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  destroy() {
    this.cleanup();
    this.manager.destroy();
  }
}

// OBD-II 응답 바이트 파싱 헬퍼
function parseObdResponse(pid: string, response: string): number[] | null {
  const upper = response.toUpperCase().replace(/\s/g, '');
  const expected = `41${pid.toUpperCase()}`;
  const idx = upper.indexOf(expected);
  if (idx === -1) return null;

  const dataHex = upper.slice(idx + expected.length);
  const bytes: number[] = [];
  for (let i = 0; i + 1 < dataHex.length; i += 2) {
    bytes.push(parseInt(dataHex.slice(i, i + 2), 16));
  }
  return bytes;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const obdBle = new ObdBleService();
