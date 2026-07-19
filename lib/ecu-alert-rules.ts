export type EcuAlertSource = {
  dtcCount: number | null;
  coolantTempC: number | null;
  batteryVoltage: number | null;
  fuelPercent: number | null;
  engineLoadPercent: number | null;
  shortFuelTrimPercent: number | null;
  longFuelTrimPercent: number | null;
  readinessSummary: string | null;
};

export type EcuAlertRuleResult = {
  key: string;
  severity: 'bad' | 'warn';
  title: string;
  value: string;
  detail: string;
};

function numberLabel(value: number, suffix: string) {
  return `${Math.round(value * 10) / 10}${suffix}`;
}

export function buildEcuAlertRules(data: EcuAlertSource): EcuAlertRuleResult[] {
  const alerts: EcuAlertRuleResult[] = [];

  if (data.dtcCount !== null && data.dtcCount > 0) {
    alerts.push({ key: 'dtc', severity: 'bad', title: '고장 코드', value: `${data.dtcCount}건`, detail: 'DTC 점검 필요' });
  }
  if (data.coolantTempC !== null && data.coolantTempC >= 105) {
    alerts.push({ key: 'coolant', severity: 'bad', title: '냉각수 온도', value: numberLabel(data.coolantTempC, '°C'), detail: '105°C 이상' });
  }
  if (data.batteryVoltage !== null && (data.batteryVoltage < 12 || data.batteryVoltage > 15)) {
    alerts.push({ key: 'battery', severity: 'warn', title: '배터리 전압', value: numberLabel(data.batteryVoltage, 'V'), detail: '정상 범위 12~15V' });
  }
  if (data.fuelPercent !== null && data.fuelPercent <= 15) {
    alerts.push({ key: 'fuel', severity: 'warn', title: '연료 잔량', value: `${data.fuelPercent}%`, detail: '15% 이하' });
  }
  if (data.engineLoadPercent !== null && data.engineLoadPercent >= 90) {
    alerts.push({ key: 'engine-load', severity: 'warn', title: '엔진 부하', value: `${data.engineLoadPercent}%`, detail: '90% 이상 지속 여부 확인' });
  }
  if (data.shortFuelTrimPercent !== null && Math.abs(data.shortFuelTrimPercent) >= 20) {
    alerts.push({ key: 'short-trim', severity: 'warn', title: '단기 연료트림', value: `${data.shortFuelTrimPercent}%`, detail: '혼합비 보정값 과다' });
  }
  if (data.longFuelTrimPercent !== null && Math.abs(data.longFuelTrimPercent) >= 20) {
    alerts.push({ key: 'long-trim', severity: 'warn', title: '장기 연료트림', value: `${data.longFuelTrimPercent}%`, detail: '혼합비 보정값 과다' });
  }
  if (data.readinessSummary && data.readinessSummary !== '준비 완료') {
    alerts.push({ key: 'readiness', severity: 'warn', title: '배출가스 준비상태', value: data.readinessSummary, detail: '검사 항목 준비 미완료' });
  }

  return alerts;
}
