import * as Speech from 'expo-speech';
import { Alert, Vibration } from 'react-native';

import type { SpeedZoneAlert } from './location-data';

export const OVERSPEED_VIBRATION_PATTERN = [0, 650, 160, 650, 160, 900];
export const OVERSPEED_REPEAT_DELAY_MS = 3_000;

const OVERSPEED_VOICE_MESSAGE = '제한속도 초과입니다. 감속하세요.';

export type OverspeedWarningState = {
  key: string;
  lastWarnedAt: number;
};

export function overspeedWarningKey(alert: SpeedZoneAlert) {
  return `${alert.tripId}-${alert.zoneName}-${Math.round(alert.speedLimitKmh)}`;
}

export function shouldShowOverspeedWarning(
  previous: OverspeedWarningState | null,
  nextKey: string,
  now = Date.now()
) {
  if (!previous || previous.key !== nextKey) return true;
  return now - previous.lastWarnedAt >= OVERSPEED_REPEAT_DELAY_MS;
}

export function createOverspeedWarningState(key: string, now = Date.now()): OverspeedWarningState {
  return { key, lastWarnedAt: now };
}

export function speakOverspeedWarning() {
  try {
    Speech.stop();
    Speech.speak(OVERSPEED_VOICE_MESSAGE, {
      language: 'ko-KR',
      pitch: 1,
      rate: 0.95,
    });
  } catch {
    // Voice guidance is helpful, but vibration and popup must still run if speech is unavailable.
  }
}

export function vibrateOverspeedWarning() {
  try {
    Vibration.vibrate(OVERSPEED_VIBRATION_PATTERN);
  } catch {
    // Some OS states can reject vibration; warning flow must still continue.
  }
}

export function showBackgroundOverspeedWarning() {
  speakOverspeedWarning();
  vibrateOverspeedWarning();
}

export function showOverspeedWarning(alert: SpeedZoneAlert) {
  const speed = Math.round(alert.speedKmh ?? 0);
  const speedLimit = Math.round(alert.speedLimitKmh);

  showBackgroundOverspeedWarning();
  Alert.alert(
    '제한속도 초과 경고',
    `${alert.vehicleNumber}\n${alert.zoneName}\n현재 ${speed}km/h / 제한 ${speedLimit}km/h\n\n즉시 감속해 주세요.`
  );
}
