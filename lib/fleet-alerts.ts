import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { buildEcuAlertRules } from './ecu-alert-rules';
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

function buildLiveAlerts(vehicle: AlertVehicle, data: ObdLiveData): LiveAlert[] {
  return buildEcuAlertRules({
    dtcCount: data.dtcCount,
    coolantTempC: data.coolantC,
    batteryVoltage: data.batteryV,
    fuelPercent: data.fuelPercent,
    engineLoadPercent: data.engineLoadPercent,
    shortFuelTrimPercent: data.shortFuelTrimPercent,
    longFuelTrimPercent: data.longFuelTrimPercent,
    readinessSummary: data.readinessSummary,
  }).map((alert) => ({
    fingerprint: `${vehicle.id}:${alert.key}:${alert.value}`,
    severity: alert.severity,
    title: alert.title,
    value: alert.value,
    detail: alert.detail,
  }));
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
