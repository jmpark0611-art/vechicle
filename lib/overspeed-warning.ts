import * as Speech from 'expo-speech';
import { Alert, Vibration } from 'react-native';

import type { SpeedZoneAlert } from './location-data';

export const OVERSPEED_VIBRATION_PATTERN = [0, 650, 160, 650, 160, 900];

export function overspeedWarningKey(alert: SpeedZoneAlert) {
  return `${alert.tripId}-${alert.zoneName}-${Math.round(alert.speedKmh ?? 0)}`;
}

export function showOverspeedWarning(alert: SpeedZoneAlert) {
  const speed = Math.round(alert.speedKmh ?? 0);
  const speedLimit = Math.round(alert.speedLimitKmh);

  try {
    Speech.stop();
    Speech.speak('제한속도 초과입니다. 감속하세요.', {
      language: 'ko-KR',
      pitch: 1,
      rate: 0.95,
    });
  } catch {
    // Voice guidance is helpful, but vibration and popup must still run if speech is unavailable.
  }

  Vibration.vibrate(OVERSPEED_VIBRATION_PATTERN);
  Alert.alert(
    '제한속도 초과 경고',
    `${alert.vehicleNumber}\n${alert.zoneName}\n현재 ${speed}km/h / 제한 ${speedLimit}km/h\n\n즉시 감속해 주세요.`
  );
}
