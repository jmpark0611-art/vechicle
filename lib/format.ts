export const STALE_ACTIVE_TRIP_MINUTES = 8 * 60;

export function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getTripElapsedMinutes(startTime: string | null, endTime: string | null = null) {
  if (!startTime) {
    return null;
  }

  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return Math.max(0, Math.round((end - start) / 60000));
}

export function formatTripDuration(startTime: string | null, endTime: string | null) {
  const minutes = getTripElapsedMinutes(startTime, endTime);

  if (minutes === null) {
    return '-';
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  const suffix = endTime ? '' : ' 진행 중';

  if (hours > 0) {
    return `${hours}시간 ${restMinutes}분${suffix}`;
  }

  return `${restMinutes}분${suffix}`;
}

export function isStaleActiveTrip(
  startTime: string | null,
  thresholdMinutes = STALE_ACTIVE_TRIP_MINUTES
) {
  const minutes = getTripElapsedMinutes(startTime);
  return minutes !== null && minutes >= thresholdMinutes;
}

export function getTripStatusText(status: string | null) {
  if (status === 'completed') {
    return '완료';
  }

  if (status === 'in_progress') {
    return '운행 중';
  }

  if (status === 'canceled') {
    return '무효';
  }

  return status ?? '미확인';
}

export function formatCoord(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  return value.toFixed(6);
}
