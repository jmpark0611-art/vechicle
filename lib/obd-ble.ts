// Web simulation — real BLE not available in browser environments.
// Metro resolves lib/obd-ble.native.ts on iOS/Android instead of this file.

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

const SIM_DEVICES: ObdDevice[] = [
  { id: 'SIM-001', name: 'Vgate iCar Pro BLE', rssi: -52 },
  { id: 'SIM-002', name: 'OBDII BLE Adapter', rssi: -71 },
];

let cbs: ObdCallbacks | null = null;
let dataTimer: ReturnType<typeof setInterval> | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let fuelLevel = 65;

function makeLiveData(): ObdLiveData {
  const t = Date.now() / 1000;
  fuelLevel = Math.max(5, fuelLevel - 0.002);
  return {
    speedKmh: Math.max(0, Math.round(50 + 35 * Math.sin(t / 9))),
    rpm: Math.max(750, Math.round(1500 + 900 * Math.abs(Math.sin(t / 6)))),
    coolantTempC: Math.round(85 + 6 * Math.sin(t / 22)),
    batteryVoltage: parseFloat((13.8 + 0.5 * Math.sin(t / 14)).toFixed(1)),
    fuelLevelPercent: Math.round(fuelLevel),
    engineLoadPercent: Math.round(30 + 20 * Math.abs(Math.sin(t / 8))),
    throttlePercent: Math.round(15 + 25 * Math.abs(Math.sin(t / 7))),
    intakeAirTempC: Math.round(28 + 3 * Math.sin(t / 30)),
    dtcCodes: [],
    ignitionOn: true,
    recordedAt: new Date().toISOString(),
  };
}

export const obdBle = {
  setCallbacks(callbacks: ObdCallbacks) {
    cbs = callbacks;
  },

  async checkBluetoothState(): Promise<boolean> {
    return true;
  },

  startScan() {
    cbs?.onStateChange('scanning', '시뮬레이션 모드 — 가상 장치를 검색합니다.');
    let i = 0;
    const addNext = () => {
      if (i < SIM_DEVICES.length) {
        cbs?.onDeviceFound(SIM_DEVICES[i++]);
        scanTimer = setTimeout(addNext, 900);
      }
    };
    scanTimer = setTimeout(addNext, 700);
  },

  stopScan() {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    cbs?.onStateChange('idle');
  },

  async connect(_deviceId: string) {
    cbs?.onStateChange('connecting');
    await new Promise((r) => setTimeout(r, 900));
    cbs?.onStateChange('initializing', 'ELM327 초기화 중...');
    await new Promise((r) => setTimeout(r, 1300));
    cbs?.onStateChange('connected', '연결 완료 (시뮬레이션)');
    cbs?.onData(makeLiveData());
    dataTimer = setInterval(() => cbs?.onData(makeLiveData()), 1000);
  },

  async disconnect() {
    if (dataTimer) { clearInterval(dataTimer); dataTimer = null; }
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    cbs?.onStateChange('idle');
  },

  async readDtcCodes() {
    await new Promise((r) => setTimeout(r, 600));
    const base = makeLiveData();
    cbs?.onData({ ...base, dtcCodes: [] });
  },
};
