const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const checkedExtensions = new Set(['.js', '.json', '.md', '.sql', '.ts', '.tsx']);
const ignoredDirs = new Set(['.expo', '.git', 'assets', 'node_modules']);
const ignoredFiles = new Set(['package-lock.json']);
const mojibakePattern = /[\ufffd\u00c3\u00c2]|(?:\u00ec|\u00eb|\u00ea|\u00ed)[\u0080-\u00ffA-Za-z]/;
const requiredText = [
  { file: 'app.json', text: '차량운행시스템' },
  { file: 'app.json', text: 'NSMicrophoneUsageDescription' },
  { file: 'app.json', text: 'RECORD_AUDIO' },
  { file: '.env.example', text: '설정 출처' },
  { file: 'README.md', text: '차량운행시스템' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: '차량운행시스템' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: 'useSafeAreaInsets' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: '최근 저장' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: 'GPS_SAVE_RETRY_COUNT' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: '마이크 권한' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: '위치 권한' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: 'latestLocationRef' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: 'accessibilityLabel="운행 출발"' },
  { file: path.join('app', '(tabs)', 'index.tsx'), text: '운행 종료' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: '시스템 점검' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: 'Expo SDK' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: '설정 출처' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: '환경변수 오류 fallback' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: 'GPS 경과' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: 'gps_points 테이블' },
  { file: path.join('app', '(tabs)', 'check.tsx'), text: '최근 진행 운행 표시' },
  { file: path.join('app', '(tabs)', 'explore.tsx'), text: 'CSV 내보내기' },
  { file: path.join('app', '(tabs)', 'explore.tsx'), text: '기간' },
  { file: path.join('app', '(tabs)', 'explore.tsx'), text: '완료 평균 소요' },
  { file: path.join('app', '(tabs)', 'explore.tsx'), text: 'GPS 누락' },
  { file: path.join('app', '(tabs)', 'explore.tsx'), text: '운행 기록 CSV 내보내기' },
  { file: path.join('app', '(tabs)', 'explore.tsx'), text: '운행 기록 더 보기' },
  { file: path.join('app', '(tabs)', '_layout.tsx'), text: 'clock.fill' },
  { file: path.join('app', '(tabs)', '_layout.tsx'), text: 'tabBarStyle' },
  { file: path.join('app', '(tabs)', '_layout.tsx'), text: 'useSafeAreaInsets' },
  { file: path.join('constants', 'theme.ts'), text: "tintColorLight = '#1565C0'" },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), text: '차량 검색' },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), text: '차량 등록' },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), text: '차량 삭제 전 운행 기록 확인' },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), text: '차량별 전체 운행 수' },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), text: '장시간' },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), text: '중복 미종료' },
  { file: path.join('app', 'trips', '[id].tsx'), text: '운행 상세' },
  { file: path.join('scripts', 'health-check.js'), text: 'EXPO_HEALTH_TRIP_ID' },
  { file: path.join('scripts', 'health-check.js'), text: 'EXPO_HEALTH_MIN_BYTES' },
  { file: path.join('lib', 'errors.ts'), text: '네트워크 연결에 실패했습니다' },
  { file: path.join('lib', 'request.ts'), text: 'clearTimeout' },
  { file: path.join('docs', 'database.md'), text: '평균/최고 속도' },
  { file: path.join('docs', 'changelog.md'), text: 'GPS 누락 경고' },
  { file: path.join('docs', 'operations.md'), text: '환경변수 오류 fallback' },
  { file: 'README.md', text: '템플릿 리셋 스크립트' },
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...walk(path.join(dir, entry.name)));
      }

      continue;
    }

    if (!entry.isFile() || ignoredFiles.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (checkedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

const failures = [];
const appCodeConsolePattern = /\bconsole\.(log|warn|error|debug|info)\s*\(/;

for (const file of walk(root)) {
  const content = fs.readFileSync(file, 'utf8');
  if (mojibakePattern.test(content)) {
    failures.push(`${relative(file)}: 한글 깨짐으로 보이는 문자가 있습니다.`);
  }

  const relativePath = relative(file);
  if (
    appCodeConsolePattern.test(content) &&
    (relativePath.startsWith('app/') ||
      relativePath.startsWith('components/') ||
      relativePath.startsWith('lib/'))
  ) {
    failures.push(`${relativePath}: 앱 코드에는 console 출력을 남기지 않습니다.`);
  }
}

for (const item of requiredText) {
  const file = path.join(root, item.file);
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  if (!content.includes(item.text)) {
    failures.push(`${relative(file)}: 필수 문구 "${item.text}"가 없습니다.`);
  }
}

const statusRoute = path.join(root, 'app', '(tabs)', 'status.tsx');
if (fs.existsSync(statusRoute)) {
  failures.push('app/(tabs)/status.tsx: Expo Metro /status와 충돌하므로 /check를 사용해야 합니다.');
}

for (const file of [
  path.join('app', '(tabs)', 'index.tsx'),
  path.join('app', '(tabs)', 'explore.tsx'),
  path.join('app', '(tabs)', 'vehicles.tsx'),
  path.join('app', '(tabs)', 'check.tsx'),
  path.join('app', 'trips', '[id].tsx'),
]) {
  const fullPath = path.join(root, file);
  const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

  if (!content.includes('useSafeAreaInsets')) {
    failures.push(`${file.replaceAll(path.sep, '/')}: 모바일 안전영역 처리를 위해 useSafeAreaInsets를 사용해야 합니다.`);
  }

  if (/paddingTop:\s*72/.test(content)) {
    failures.push(`${file.replaceAll(path.sep, '/')}: 고정 paddingTop 72 대신 안전영역 기반 여백을 사용해야 합니다.`);
  }
}

for (const item of [
  { file: path.join('app', '(tabs)', 'explore.tsx'), styles: ['chipBtn', 'filterBtn', 'tripActionBtn', 'loadMoreBtn'] },
  { file: path.join('app', '(tabs)', 'vehicles.tsx'), styles: ['filterBtn', 'actionBtn'] },
  { file: path.join('app', '(tabs)', 'check.tsx'), styles: ['detailBtn', 'reloadBtn'] },
]) {
  const fullPath = path.join(root, item.file);
  const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

  for (const styleName of item.styles) {
    const styleMatch = content.match(new RegExp(`${styleName}:\\s*{([\\s\\S]*?)\\n\\s*}`));
    const minHeightMatch = styleMatch?.[1]?.match(/minHeight:\s*(\d+)/);
    const minHeight = minHeightMatch ? Number(minHeightMatch[1]) : null;

    if (minHeight === null || minHeight < 44) {
      failures.push(
        `${item.file.replaceAll(path.sep, '/')}: ${styleName}은 모바일 터치 편의성을 위해 minHeight 44 이상이어야 합니다.`
      );
    }
  }
}

for (const file of [
  path.join('app', '(tabs)', 'index.tsx'),
  path.join('app', '(tabs)', 'explore.tsx'),
  path.join('app', '(tabs)', 'vehicles.tsx'),
]) {
  const fullPath = path.join(root, file);
  const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

  for (const text of ['automaticallyAdjustKeyboardInsets', 'keyboardDismissMode="on-drag"', 'keyboardShouldPersistTaps="handled"']) {
    if (!content.includes(text)) {
      failures.push(`${file.replaceAll(path.sep, '/')}: 입력 중 모바일 키보드 대응을 위해 ${text} 설정이 필요합니다.`);
    }
  }
}

const modalRoute = path.join(root, 'app', 'modal.tsx');
if (fs.existsSync(modalRoute)) {
  failures.push('app/modal.tsx: 차량운행시스템에서 사용하지 않는 Expo 템플릿 모달 라우트는 제거해야 합니다.');
}

const appExampleDir = path.join(root, 'app-example');
if (fs.existsSync(appExampleDir)) {
  failures.push('app-example: Expo 템플릿 예제 폴더는 업무 앱에 포함하지 않습니다.');
}

const resetProjectScript = path.join(root, 'scripts', 'reset-project.js');
if (fs.existsSync(resetProjectScript)) {
  failures.push('scripts/reset-project.js: 업무 앱 파일을 삭제할 수 있는 Expo 템플릿 리셋 스크립트는 제거해야 합니다.');
}

if (failures.length > 0) {
  console.error('source-check 실패');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('source-check OK');
