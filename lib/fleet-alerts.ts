import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import type { ObdLiveData } from './obd-ble';

export type AlertVehicle = {
  id: string;
  vehicleNumber: string;
};

type LiveAlert = {
  fingerprint: string;
  severity: 'bad' | 'warn';
  title: string;
  value: string;
  detail: string;
};

const POPUP_STORAGE_KEY = 'vehicle-ecu-alert-popups-v1';

function numberLabel(value: number, suffix: string) {
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function pushAlert(
  alerts: LiveAlert[],
  vehicle: AlertVehicle,
  key: string,
  severity: LiveAlert['severity'],
  title: string,
  value: string,
  detail: string
) {
  alerts.push({
    fingerprint: `${vehicle.id}:${key}:${value}`,
    severity,
    title,
    value,
    detail,
  });
}

function buildLiveAlerts(vehicle: AlertVehicle, data: ObdLiveData): LiveAlert[] {
  const alerts: LiveAlert[] = [];
  if (data.dtcCount !== null && data.dtcCount > 0) {
    pushAlert(alerts, vehicle, 'dtc', 'bad', '고장 코드', `${data.dtcCount}건`, 'DTC 점검 필요');
  }
  if (data.coolantC !== null && data.coolantC >= 105) {
    pushAlert(alerts, vehicle, 'coolant', 'bad', '냉각수 온도', numberLabel(data.coolantC, '°C'), '105°C 이상');
  }
  if (data.batteryV !== null && (data.batteryV < 12 || data.batteryV > 15)) {
    pushAlert(alerts, vehicle, 'battery', 'warn', '배터리 전압', numberLabel(data.batteryV, 'V'), '정상 범위 12~15V');
  }
  if (data.fuelPercent !== null && data.fuelPercent <= 15) {
    pushAlert(alerts, vehicle, 'fuel', 'warn', '연료 잔량', `${data.fuelPercent}%`, '15% 이하');
  }
  if (data.engineLoadPercent !== null && data.engineLoadPercent >= 90) {
    pushAlert(alerts, vehicle, 'engine-load', 'warn', '엔진 부하', `${data.engineLoadPercent}%`, '90% 이상 지속 여부 확인');
  }
  if (data.shortFuelTrimPercent !== null && Math.abs(data.shortFuelTrimPercent) >= 20) {
    pushAlert(alerts, vehicle, 'short-trim', 'warn', '단기 연료트림', `${data.shortFuelTrimPercent}%`, '혼합비 보정값 과다');
  }
  if (data.longFuelTrimPercent !== null && Math.abs(data.longFuelTrimPercent) >= 20) {
    pushAlert(alerts, vehicle, 'long-trim', 'warn', '장기 연료트림', `${data.longFuelTrimPercent}%`, '혼합비 보정값 과다');
  }
  if (data.readinessSummary && data.readinessSummary !== '준비 완료') {
    pushAlert(alerts, vehicle, 'readiness', 'warn', '배출가스 준비상태', data.readinessSummary, '검사 항목 준비 미완료');
  }
  return alerts;
}

async function loadShownPopups(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(POPUP_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function saveShownPopups(items: Set<string>) {
  await AsyncStorage.setItem(POPUP_STORAGE_KEY, JSON.stringify([...items]));
}

export async function showLiveEcuAlertPopup(vehicle: AlertVehicle, data: ObdLiveData): Promise<void> {
  const alerts = buildLiveAlerts(vehicle, data);
  if (alerts.length === 0) return;

  const shown = await loadShownPopups();
  const pending = alerts.filter((item) => !shown.has(item.fingerprint));
  if (pending.length === 0) return;

  for (const item of pending) {
    shown.add(item.fingerprint);
  }
  await saveShownPopups(shown);

  const title = pending.some((item) => item.severity === 'bad') ? '정비 필요 알림' : '점검 필요 알림';
  const body = pending
    .slice(0, 4)
    .map((item) => `${vehicle.vehicleNumber} · ${item.title}: ${item.value} (${item.detail})`)
    .join('\n');
  const suffix = pending.length > 4 ? `\n외 ${pending.length - 4}건` : '';
  Alert.alert(title, `${body}${suffix}`);
}
