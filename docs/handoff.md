# 인수인계 메모

## 프로젝트

- 앱 이름: 차량운행시스템
- 기반: Expo SDK 54, Expo Router, Supabase
- 주요 경로: `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `app/(tabs)/vehicles.tsx`, `app/(tabs)/check.tsx`, `app/trips/[id].tsx`
- 협업 기준: GitHub `main` 브랜치를 기준 원본으로 사용한다. 로컬 미커밋 변경은 임시 작업으로 보고, 작업 시작 전 `main` 최신 상태를 pull/fetch한 뒤 진행한다.

## 현재 화면

- `역할 선택` (`/role-select`): 최초 실행 또는 역할 미설정 시 진입. 운전자/수송부 간부 선택. 간부는 PIN 설정 화면으로 이동.
- `PIN 잠금` (`/commander-pin`): 4자리 숫자패드. 최초 설정(setup) / 앱 시작 시 확인(verify) / 점검 탭에서 변경(change) 3가지 모드. 잘못된 PIN 입력 시 shake 애니메이션 + 오류 안내. 스플래시 화면이 역할/PIN 확인 전에 닫히지 않아 flash 없이 진입.
- `운행`: 차량 선택, 출발지/목적지 입력, 프리셋, 웹 음성 입력과 마이크 권한 안내, 위치 권한 상태, 운행 시작/종료, 진행 중 운행 복구, 저장 타임아웃, GPS 저장 재시도와 저장 상태 표시, 오프라인 미전송 큐 개수 표시
- `기록`: 30건 단위 더 보기 목록, 상태/기간/차량 필터, 검색, 필터 결과 요약 통계, 웹 CSV 내보내기, GPS 요약, GPS 누락 경고, 장시간 미종료 경고
- `차량`: 차량 등록/수정/삭제, 차량번호 중복 선검사, 삭제 전 DB 운행 기록 재확인, 차량별 exact 운행 수, 검색/상태 필터, 요약 통계, 차량별 운행 상태, 중복 미종료 운행 경고
- `점검`: 앱/SDK 버전, Supabase 연결/카운트/GPS/최근 GPS 경과/중복 진행 운행/진행 운행 표시 수/실기기 확인 안내, 사용자 역할·PIN 상태(간부 전용)·GPS 대기 큐 개수, 누적 접속 카운터 표시, 역할 변경, PIN 변경(수송부 간부 전용)
- `위치` (`/map`, 수송부 간부 전용): Leaflet.js + OpenStreetMap 지도로 운행 중인 차량의 현재 위치 표시. 지도 아래 차량 목록 패널에서 차량번호·경로·마지막 GPS 시각·상태 뱃지(미수신/오래됨/장시간)를 확인할 수 있다. Supabase Realtime(gps_points INSERT, trips 변경) + 60초 폴백 폴링. 운행 중 차량 없으면 empty state 표시.
- `운행 상세`: 차량 정보, 출발지/목적지, 출발/종료 시각, 8시간 경과 경고, 진행 중 운행 무효 처리. GPS 경로/좌표 미표시(정책: 이동 동선 비공개)

## 실행

```powershell
npm.cmd ci
npm.cmd run start:offline
```

Android Expo Go 실기기 확인:

```powershell
npm.cmd run start:lan
```

기본 URL:

```text
http://localhost:8082/
```

## 검증

```powershell
npm.cmd run verify
npm.cmd run health
```

`verify`는 한글 깨짐/시스템명/라우트 충돌 점검, ESLint, TypeScript 검사를 포함한다.
`source-check`는 앱 코드의 불필요한 콘솔 출력도 실패로 처리한다.
`EXPO_HEALTH_TRIP_ID`에 운행 ID를 넣고 `npm.cmd run health`를 실행하면 `/trips/[id]` 상세 응답도 함께 확인한다.

## Supabase

- 기준 SQL: `docs/schema.sql`
- 상태값: `in_progress`, `completed`, `canceled`
- `lib/supabase.js`에는 개발 확인용 fallback DB 값이 남아 있다.
- 운영 또는 다른 PC에서는 `.env.local`에 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`를 설정하고 `/check`에서 설정 출처가 `환경변수`로 표시되는지 확인한다. URL이 잘못되면 `환경변수 오류 fallback`으로 표시된다.
- `/status` 라우트는 Expo Metro 내부 엔드포인트와 충돌하므로 앱 점검 화면은 `/check`를 사용한다.

## 역할 및 인증

- 앱 시작 시 `AsyncStorage`에 저장된 역할(`@app_role`)을 읽어 미설정이면 `/role-select`로 이동.
- 수송부 간부 역할은 PIN 설정/확인 없이는 `@app_role`이 저장되지 않는다. PIN 확인 성공 후 `setStoredRole('commander')`가 호출된다.
- 간부 재진입 시(`role=commander` + PIN 저장됨): 스플래시 화면을 유지한 채 `/commander-pin` verify 모드로 이동. PIN 없이는 탭 화면에 진입 불가.
- 역할 변경 시 `clearStoredRole()` 후 `/role-select`로 이동. PIN은 별도 변경 필요(`/commander-pin?change=1`).
- 관련 파일: `lib/role.ts`, `lib/commander-pin.ts`, `app/role-select.tsx`, `app/commander-pin.tsx`, `app/_layout.tsx`

## 수리부속 교체 주기 관리

- `차량` 탭 각 차량 카드의 **정비** 버튼 → `/vehicles/[id]` 화면으로 이동.
- 정비 화면은 현대·기아 권장 교체 주기 기준 12개 항목을 표시한다.
- **상태 뱃지**: 정상(초록) / 주의(노랑, 교체 임박) / 교체 필요(빨강, 기간/km 초과) / 미기록(회색).
- **날짜·km 이중 판정**: `next_due_date` 기준 날짜와 `current_mileage_km` 대비 `next_due_mileage_km` km 중 더 나쁜 쪽을 상태로 표시.
- **오도미터 입력**: 화면 상단에서 현재 주행거리를 수동 입력/저장. `vehicles.current_mileage_km` 컬럼에 저장.
- **교체 완료**: 오늘 날짜·입력 km 기준으로 다음 교체 일자·km 자동 계산. `vehicle_maintenance` upsert + `vehicle_maintenance_history` insert.
- **교체 이력**: 항목별 최근 5건 교체 날짜·주행거리를 카드 내 표시.
- **UI 톤**: 운행 홈, 기록, 차량 목록, 정비 상세, 점검, 관제 지도, 역할 선택, PIN, 운행 상세 화면은 다크 카드, 라임 포인트, 차량/부속/상태 이모지 아이콘을 사용한다. 공통 테마와 하단 탭바도 다크 배경+라임 포인트 기준으로 맞췄다. 추가 화면도 사진형 이모지/아이콘은 크게 쓰되 정보는 짧은 라벨과 숫자 중심으로 유지한다.
- **차량 카드 뱃지**: 교체 필요 항목 있으면 정비 버튼 빨간색+건수. 주의 항목만 있으면 노란색.
- **탭바 뱃지**: 전체 차량 교체 필요 항목 수를 `차량` 탭에 숫자 뱃지로 표시.
- 관련 테이블: `maintenance_items`, `vehicle_maintenance`, `vehicle_maintenance_history`.
- OBD 스캐너(Vgate iCar Pro) 연동으로 오도미터 자동 입력 예정 → `docs/obd-integration.md` 참고.

## 오프라인 GPS 큐

- GPS 저장 실패(재시도 포함)시 `lib/gps-queue.ts`의 `enqueueGpsPoint()`로 AsyncStorage 큐(`@gps_queue`)에 저장. 최대 200개.
- 앱 활성화(foreground 복귀) 및 초기 로드 시 `flushGpsQueue()`로 큐를 일괄 업로드 시도. 실패한 것은 다시 큐에 보관.
- 운행 화면 GPS 카드에 미전송 큐 개수를 표시해 사용자가 오프라인 상태를 인지할 수 있도록 함.

## 지도

- 수송부 간부 전용 `위치` 탭: Leaflet.js(CDN) + OpenStreetMap(무료, API key 불필요).
- 네이티브: `react-native-webview` → `components/vehicle-map.native.tsx`
- 웹: iframe → `components/vehicle-map.web.tsx`
- Bundler가 플랫폼별로 자동 선택. `components/vehicle-map.tsx`는 TypeScript tsc가 참조하는 베이스 파일.
- **정책**: 차량 이동 경로/동선은 운전자·간부 모두에게 비공개. 간부는 구난 목적의 현재 위치만 조회.

## EAS 빌드

```bash
# 로컬 PC에서 실행 (eas-cli 필요)
npm install -g eas-cli
eas login
eas build --profile preview --platform android   # APK (내부 테스트)
eas build --profile production --platform android # AAB (스토어 배포)
```

- `eas.json`: preview=APK internal, production=AAB autoIncrement
- `app.json`: `android.package = "com.vehicle.tracking"` (EAS 필수)

## 보안

- 수송부 간부 PIN은 `expo-secure-store`(암호화 키체인)에 저장된다. 키 이름: `commander_pin`.
- `gps_points`, `vehicles`, `trips` 테이블은 모두 RLS가 활성화되어 있고 anon 역할에 CRUD 정책이 적용되어 있다. 별도 Supabase 인증 없이 anon 키로 읽기/쓰기가 가능하다.
- 접속 카운터는 앱 시작 시 `increment_access_counter` RPC로 `app_access_counters`의 `app_open` 값을 증가시키고, 점검 화면에서 누적 접속/최근 집계 시간을 표시한다. 스키마가 아직 적용되지 않은 환경에서는 앱 흐름을 막지 않고 `-`로 표시한다.
- 관제 지도 팝업의 차량번호·경로 텍스트는 HTML 이스케이프 처리 후 삽입된다.

## 주의점

- GitHub 레포/브랜치로 넘길 때는 `docs/github-handoff.md`를 먼저 확인한다.
- Expo 템플릿의 `reset-project` 스크립트는 업무 앱 파일을 삭제할 수 있어 제거했다. 다시 생기면 `npm.cmd run source-check`가 실패한다.
- 사용하지 않는 Expo 템플릿 모달 라우트와 `app-example` 폴더도 source-check에서 막는다.
- 사용하지 않는 기본 템플릿 컴포넌트는 정리했고, 현재 탭 UI는 `components/haptic-tab.tsx`와 `components/ui/icon-symbol.tsx`를 사용한다.
- 기록 화면은 기본 30건을 조회하고 `운행 기록 더 보기`로 30건씩 확장한다. CSV 내보내기는 현재 웹 브라우저에서 동작하며, Expo Go 네이티브 파일 저장은 별도 모듈이 필요하다.
- 기록 화면의 기간/차량 필터는 검색어가 없어도 적용되며, 완료 운행인데 GPS 포인트가 없으면 GPS 누락으로 표시한다.
- 차량 화면의 전체/완료/미종료 운행 수는 차량별 Supabase exact count로 계산한다. 최근 운행 링크와 장시간 표시용 운행 목록은 최근 100건 기준이다.
- 점검 화면의 진행 중 운행 목록은 최근 10건을 보여주고, 전체 진행 운행 수가 더 많으면 표시 수 안내를 함께 보여준다.
- 운행 상세에서 GPS 경로/좌표는 표시하지 않는다(정책: 이동 동선 비공개). trips 기본 정보와 무효 처리만 제공.
- Android Expo Go에서는 네이티브 음성 인식 모듈이 기본 포함되지 않으므로 현재 음성 입력은 웹 브라우저 중심이다. 브라우저에서는 권한 차단, 음성 미감지, 마이크 장치 오류를 운행 화면 안내 박스로 표시한다. `app.json`에는 추후 개발 빌드 확장을 대비해 위치/마이크 권한 문구를 명시해 두었다.
- 주요 ScrollView 화면은 `useSafeAreaInsets`로 상단 노치와 하단 홈 인디케이터/탭바 여백을 반영한다. 새 화면을 추가할 때도 고정 `paddingTop` 대신 안전영역 기반 여백을 사용한다.
- 하단 탭바도 `useSafeAreaInsets`로 홈 인디케이터 여백과 최소 터치 높이를 반영한다.
- 작은 Android/iPhone 폭에서 텍스트와 버튼이 잘리지 않도록 툴바, 카드 헤더, 정보 행, 주요 액션 행은 `flexWrap`과 `gap`을 사용한다.
- 긴 차량번호/장소/요약 값은 `numberOfLines`, `adjustsFontSizeToFit`, `minWidth: 0`으로 모바일 폭 안에 머물도록 처리한다.
- 기록/차량 필터 바는 작은 화면에서 2열로 감기도록 `flexBasis`와 `flexWrap`을 사용한다.
- 공통 테마 색상은 차량운행시스템의 업무용 파랑/회색 팔레트로 맞췄고, 하단 탭바는 `Colors`의 `card`, `border`, `tabIconDefault`, `tint`를 사용한다.
- 필터/chip/상세 버튼은 모바일 터치 편의성을 위해 최소 44px 높이를 기준으로 둔다.
- `source-check`는 주요 터치 버튼 스타일의 `minHeight`가 44px 미만으로 내려가면 실패 처리한다.
- 입력 화면의 ScrollView는 `automaticallyAdjustKeyboardInsets`, `keyboardDismissMode="on-drag"`, `keyboardShouldPersistTaps="handled"`로 모바일 키보드 사용성을 보강한다.
- 진행 중 운행이 이미 있으면 운행 시작 시 새 운행을 만들지 않고 기존 운행을 복구한다.
- 운행 화면은 최신 GPS 좌표를 ref로 보관해 위치 변경 때마다 대시보드 복구 로직이 불필요하게 재생성되지 않도록 했다.
- Supabase 요청은 `lib/request.ts`의 `withTimeout`을 거치며, 완료 후 내부 타이머를 정리한다.
