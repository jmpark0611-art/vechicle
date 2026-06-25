const http = require('node:http');

const baseUrl = process.env.EXPO_HEALTH_URL || 'http://localhost:8082';
const detailTripId = process.env.EXPO_HEALTH_TRIP_ID?.trim();
const requestTimeoutMs = Number(process.env.EXPO_HEALTH_TIMEOUT_MS ?? 30000);
const retryDelayMs = Number(process.env.EXPO_HEALTH_RETRY_DELAY_MS ?? 1500);
const minResponseBytes = Number(process.env.EXPO_HEALTH_MIN_BYTES ?? 1000);
const checks = [
  { path: '/', label: '운행' },
  { path: '/explore', label: '기록' },
  { path: '/vehicles', label: '차량' },
  { path: '/check', label: '점검' },
];

if (detailTripId) {
  checks.push({ path: `/trips/${encodeURIComponent(detailTripId)}`, label: '운행 상세' });
}

function request(path) {
  return new Promise((resolve) => {
    const req = http.get(`${baseUrl}${path}`, { timeout: requestTimeoutMs }, (res) => {
      let length = 0;

      res.on('data', (chunk) => {
        length += chunk.length;
      });

      res.on('end', () => {
        resolve({ path, status: res.statusCode, length });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (error) => {
      resolve({ path, error: error.message });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestWithRetry(path) {
  const first = await request(path);

  if (!('error' in first) && first.status === 200) {
    return first;
  }

  await wait(retryDelayMs);
  const second = await request(path);

  return {
    ...second,
    retried: true,
  };
}

async function main() {
  console.log(`차량운행시스템 health check: ${baseUrl}`);

  const results = [];
  let hasFailure = false;

  for (const check of checks) {
    results.push(await requestWithRetry(check.path));
  }

  for (const [index, result] of results.entries()) {
    const check = checks[index];

    if ('error' in result || result.status !== 200 || result.length < minResponseBytes) {
      hasFailure = true;
      const detail =
        'error' in result
          ? result.error
          : result.status !== 200
            ? `HTTP ${result.status}`
            : `응답이 너무 작음 (${result.length} bytes)`;
      console.error(`FAIL ${check.label} ${check.path}: ${detail}`);
      continue;
    }

    const retryText = result.retried ? ' after retry' : '';
    console.log(`OK   ${check.label} ${check.path}: ${result.length} bytes${retryText}`);
  }

  const statusCheck = await requestWithRetry('/status');
  if ('error' in statusCheck) {
    console.log('INFO /status: Expo 내부 상태 엔드포인트 확인 실패');
  } else {
    console.log(`INFO /status: Expo 내부 엔드포인트로 예약됨 (HTTP ${statusCheck.status})`);
  }

  if (!detailTripId) {
    console.log('INFO 운행 상세: EXPO_HEALTH_TRIP_ID가 있으면 /trips/[id]도 확인합니다.');
  }
  console.log(`INFO 최소 응답 크기: ${minResponseBytes} bytes`);

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main();
