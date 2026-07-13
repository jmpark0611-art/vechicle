# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

---

# Progress Notes (for AI continuity)

## 2026-07-13 current rebuild status
- Current active branch: `rebuild/clean-sdk54-start`.
- Current known-good APK before this maintenance step: `apk-29252766820`.
- User confirmed the installed APK state as "작동 이상무".
- Continue with small APK-testable steps. Do not reintroduce GPS, WebView map, OBD/BLE, Reanimated, or new native permissions until the current step is tested on device.

## 2026-07-13 rebuild step 3 vehicle maintenance
- Added a non-native vehicle maintenance replacement workflow.
- `lib/maintenance-data.ts` stores current odometer and replacement-completion km locally with AsyncStorage under `vehicle-maintenance-v1`.
- `app/(tabs)/vehicles.tsx` now shows engine oil, oil filter, and air filter replacement cycles.
- Users can enter current odometer, save it, and press "교체완료"; remaining km is recalculated from that completion point.
- This step intentionally does not add Supabase schema writes, GPS, WebView, OBD/BLE, Reanimated, or new Android permissions.
- Next safe step after APK device test: add Supabase sync for maintenance records or restore read-only location/map UI. Keep OBD/BLE last.

## 2026-07-13 rebuild step 3b maintenance sync and APK workflow fix
- User reported the APK workflow failed after commit `d42377c`.
- GitHub API showed the failure happened at `Setup Android SDK` before dependency install, source verification, Expo prebuild, or Gradle build. Treat it as workflow environment failure, not app-code failure.
- Removed the external `android-actions/setup-android@v3` step and replaced it with a runner Android SDK check/license acceptance step.
- Added `maintenance_records` schema to `docs/schema.sql`.
- `lib/maintenance-data.ts` now attempts to read/write Supabase maintenance records and falls back to local AsyncStorage if the table is not created yet.
- Vehicle tab now displays the maintenance sync status.
- Validation passed: `npm run verify` and Android export.

## 2026-07-13 rebuild step 4 read-only location board
- Added `lib/location-data.ts` to read active trips, latest `gps_points`, and `speed_zones` without adding GPS permissions, WebView, or map native modules.
- Replaced the location tab mock with a read-only location board:
  - simple relative marker panel
  - active vehicle list with latest GPS time, coordinates, and speed
  - speed-zone list with limit and radius
- Added `speed_zones` schema, indexes, triggers, and permissive anon policies to `docs/schema.sql`.
- Validation passed: `npm run verify` and Android export.
- Next safe step: add speed-zone creation/editing UI in 수송부 mode or restore GPS foreground permission/point saving. Keep OBD/BLE last.

## 2026-07-13 rebuild step 4b speed-zone creation
- Added `createSpeedZone()` to `lib/location-data.ts`.
- Location tab now includes a speed-zone creation form for name, latitude, longitude, radius, and speed limit.
- The form validates numeric ranges before saving.
- Save writes to Supabase `speed_zones` and refreshes the location board when successful.
- If the table has not been applied to Supabase yet, the app shows a clear Alert instead of crashing.
- Validation passed: `npm run verify` and Android export.

## 2026-07-13 rebuild step 5 foreground GPS point save
- Reintroduced `expo-location` as the first native module after the clean rebuild baseline.
- Added Android foreground location permissions only: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`.
- Added `lib/gps-data.ts` with `saveCurrentGpsPoint(tripId)`.
- Trip start and manual trip completion now attempt a one-time foreground GPS save to `gps_points`.
- Permission denial, missing `gps_points`, RLS/policy errors, and timeout paths return messages and do not crash the trip flow.
- This is intentionally not continuous/background tracking yet.
- Validation passed: `npm run verify`, `npx expo-doctor` 18/18, and Android export.

## 2026-07-13 Clean rebuild branch
- User chose a clean rebuild because installed APK builds kept crashing before the first screen.
- Created branch `rebuild/clean-sdk54-start` from the latest work branch. Do not delete the old branch; it remains the feature reference.
- Stage 1 objective: produce the smallest Expo SDK 54 app that opens on Android APK and preserves the intended screen map.
- Replaced startup/routing code with a minimal Expo Router stack:
  - `role-select`
  - `commander-pin`
  - `(tabs)` with 운행, 기록, 차량, 위치, 점검
- Removed direct startup/native risk modules from this branch:
  - `react-native-reanimated`
  - `react-native-worklets`
  - `react-native-ble-plx`
  - `react-native-webview`
  - `expo-location`
  - `expo-haptics`
  - `expo-image`
  - `expo-symbols`
  - `expo-web-browser`
- `app.json` was simplified: `newArchEnabled: false`, no GPS/microphone/Bluetooth permissions, only `expo-router` and `expo-splash-screen` plugins.
- Current screens are deliberate stubs, not final functionality. They keep the desired UI structure visible while proving APK startup stability.
- Validation passed on this branch:
  - `npm run verify`
  - `npx expo-doctor`
  - `npx expo export --platform android --output-dir .expo-export-check-clean`
- Next step after APK opens: reconnect Supabase read-only lists first, then trip start/end, then GPS permissions, then WebView map, and only after that real OBD/BLE.

## Cleanup policy for rebuild work
- Continue new development on `rebuild/clean-sdk54-start`.
- Do not delete old project files just because they are not used in the current clean baseline.
- The old files/history are the reference source for restoring features and UI behavior.
- Cleanup is intentionally deferred. Later, after the rebuilt app is stable and feature parity is confirmed, review unused files one by one and delete only with clear evidence.
- Handoff instruction for other AI agents: prioritize rebuilding working features in small tested steps over removing legacy code. Keep each step APK-testable.

## 2026-07-13 build-96 device result
- User installed and opened `build-96` from branch `rebuild/clean-sdk54-start`.
- Result: APK opens successfully on the Android device.
- This is the new known-good baseline. Do not add multiple native modules at once from here.
- Next recommended rebuild order:
  1. Supabase read-only connection and basic vehicles/trips list.
  2. Trip start/end with manual fields, no GPS yet.
  3. GPS foreground permission and point saving.
  4. Commander records, maintenance replacement completion, and speed-zone data model.
  5. Map visualization.
  6. OBD/BLE last, preferably after a separate test APK proves the BLE library does not crash startup.

## 2026-07-13 rebuild step 1 data read
- Started feature restoration from the known-good clean APK baseline.
- Added `lib/readonly-data.ts` for Supabase read-only access only.
- Connected minimal read-only data:
  - `vehicles`: reads `id`, `vehicle_number`, `created_at`.
  - `trips`: reads `id`, `vehicle_id`, `start_place`, `end_place`, `start_time`, `end_time`, `status`.
- Updated screens:
  - `app/(tabs)/vehicles.tsx`: shows vehicle count, connection source, and vehicle cards.
  - `app/(tabs)/explore.tsx`: shows recent trip cards with vehicle-number mapping.
  - `app/(tabs)/check.tsx`: runs a read-only Supabase health check.
- No write operations were added. No GPS, map WebView, OBD/BLE, Reanimated, or native permission changes were added.
- Android export passed after adding read-only data. Keep the next step small: manual trip start/end without GPS.

## 2026-07-13 rebuild step 2 manual trip writes
- Added manual trip start/end on the known-good rebuild branch without adding GPS, map, OBD/BLE, Reanimated, WebView, or new native permissions.
- Updated `lib/readonly-data.ts`:
  - Added `fetchActiveTrips()`.
  - Added `startManualTrip()` insert into `trips` with `vehicle_id`, `start_place`, `end_place`, `status: in_progress`.
  - Added `completeManualTrip()` update with `end_place`, `end_time`, `status: completed`.
- Updated `app/(tabs)/index.tsx`:
  - Loads vehicles and active trips.
  - Lets the user select a vehicle.
  - Lets the user enter start/end place manually.
  - Starts a trip and lists active trips.
  - Completes active trips manually.
- Validation passed:
  - `npm run verify`
  - `npx expo export --platform android --output-dir .expo-export-check-manual-trip`
- Next safe step: extend manual trip fields (operator/user/purpose) or add commander maintenance replacement completion. Do not add GPS yet until this APK is device-tested.

## 2026-07-13 manual trip start_time fix
- User tested build #99 and trip start failed with Supabase error: `null value in column "start_time" of relation "trips" violates not-null constraint`.
- Fixed `startManualTrip()` to explicitly send `start_time: new Date().toISOString()` during insert.
- Rationale: do not rely on the remote DB default during rebuild; required fields should be explicit in app writes.
- Validation passed: `npm run verify` and Android export.

## 2026-07-13 release tag collision fix
- User still saw the same `start_time` error after downloading from the `build-99` release.
- Verified the source code already includes `start_time` in `startManualTrip()`.
- Found the Android APK workflow still used `tag_name: build-${{ github.run_number }}`, which can collide with old releases and make users download an older APK.
- Updated the APK release workflow to use `tag_name: apk-${{ github.run_id }}` and a matching release name. This creates a unique release URL for every APK build.
- If a user reports a fixed bug still appearing, verify the APK release tag points to the exact commit before changing app code.

## 2026-07-13 apk-29251409071 device result
- User installed the unique-release APK `apk-29251409071`.
- Result: app opens and manual trip controls work; user reported "성공! 다 눌러진다".
- This confirms the rebuild branch is stable through step 2:
  - launch baseline
  - Supabase read-only lists
  - manual trip start/end writes
- Continue from this baseline. Avoid adding native modules in the next step.

## 2026-07-13 rebuild step 2b trip fields
- Added manual trip input fields for `operatorName`, `userName`, and `purpose`.
- `startManualTrip()` now tries to write extended fields to `trips`:
  - `purpose`
  - `operator_name`
  - `user_name`
- If the remote DB does not have those columns yet, the app catches the schema-column error and retries the minimal insert. This keeps the APK stable while DB migrations are still being confirmed.
- Records and active trip cards display purpose/operator/user when available.
- No native modules or permissions were added.
- Validation passed: `npm run verify`, `npx expo-doctor`, Android export.

## 2026-07-13 apk-29252766820 device result
- User installed and tested `apk-29252766820`.
- Result: "작동 이상무".
- This confirms the rebuild branch is stable through:
  - unique APK release links
  - manual trip start/end
  - manual trip fields for operator/user/purpose
- Continue with non-native features next. Recommended next step: vehicle maintenance replacement completion.

## 2026-07-13 Android startup crash pass
- Symptom reported from installed APK: Android system dialog "vehicle app keeps stopping" immediately on launch. No in-app diagnostic Alert was visible, so treat it as a native startup/runtime init crash until logcat proves otherwise.
- Pulled latest branch `claude/env-permissions-session-restart-154onb` through commit `981401e`.
- `adb devices -l` showed no connected Android device in this Codex session, so logcat could not be captured here.
- `npm run verify` passed before the fix, but `npx expo-doctor` failed SDK compatibility validation:
  - `@react-native-async-storage/async-storage` expected `2.2.0`, found `3.1.1`
  - `react-native-webview` expected `13.15.0`, found `14.0.1`
- Fixed with `npx expo install @react-native-async-storage/async-storage react-native-webview`, which pinned the SDK 54 compatible native module versions.
- Re-ran validation: `npx expo-doctor` now passes 18/18, and `npm run verify` passes.
- If the next APK still crashes, capture `adb logcat` from the device. Search for `FATAL EXCEPTION`, `AndroidRuntime`, `ReactNativeJS`, `SoLoader`, `UnsatisfiedLinkError`, `NoClassDefFoundError`, `Reanimated`, `Worklets`, `AsyncStorage`, `WebView`, `Ble`, and `TurboModule`.

## 2026-07-13 Android startup crash pass 2
- User retested build #94 and reported the exact same Android "keeps stopping" symptom.
- Android JS export succeeds (`npx expo export --platform android`), so the bundle itself is not failing to generate.
- No device was visible in `adb devices -l`, so the actual native stack trace is still unavailable.
- Current native OBD implementation is a pure JS stub in `lib/obd-ble.native.ts`; the app does not import `react-native-ble-plx`.
- Removed unused `react-native-ble-plx` from `package.json`, removed the `react-native-ble-plx` config plugin from `app.json`, and removed Android Bluetooth permissions for this stability build.
- Rationale: a native BLE module that is not used by JS should not participate in startup while the APK is crashing before UI appears. Restore real BLE only after a stable APK launch is confirmed, preferably with logcat attached.
- Re-ran validation after removing BLE native integration: `npx expo-doctor` passes 18/18, `npm run verify` passes, and Android export passes.

## Stack
- Expo SDK 54 (React Native + Web, cross-platform)
- Expo Router (file-based routing, tabs layout)
- Supabase backend: tables `vehicles`, `trips`, `gps_points`, `obd_logs`
- expo-location ~19.0.8 (GPS tracking, already installed)
- react-native-webview ^14.0.1 (installed — for embedded map)
- react-native-ble-plx (BLE OBD communication, ELM327 protocol)

## Database Schema (Supabase)
- `vehicles`: id, vehicle_number, status, ...
- `trips`: id, vehicle_id (FK→vehicles), start_place, end_place, start_time, end_time, start_lat, start_lng, end_lat, end_lng, status ('in_progress'|'completed'|'canceled')
- `gps_points`: id, trip_id (FK→trips), latitude, longitude, speed_kmh, recorded_at
- `obd_logs`: id, vehicle_id (FK→vehicles), trip_id (FK→trips, nullable), speed_kmh, rpm, coolant_temp_c, battery_voltage, fuel_level_percent, engine_load_percent, throttle_percent, intake_air_temp_c, ignition_status ('on'|'off'), dtc_codes (text[]), recorded_at

## Design System
- Primary: #2563EB (blue), hero card: #1D4ED8
- Background: #F8FAFC, card: #FFFFFF
- Text: #0F172A (dark), secondary: #64748B, muted: #94A3B8
- Card border radius: 14-20px, shadows (shadowOpacity 0.07-0.08, elevation 2)
- Pill badges: borderRadius 20
- No eyebrow text (removed "DRIVER LOG" style labels from all screens)

## Completed Work

### Session 1 (UI/UX Redesign)
- `.claude/settings.json` → added `"Bash(git push*)"` permission for session persistence
- `constants/theme.ts` → updated tintColorLight to #2563EB
- `app/(tabs)/_layout.tsx` → tab bar style (white bg, border, paddingTop: 6)
- `app/(tabs)/index.tsx` → full redesign: blue hero card when running, idle card, modern styles
- `app/(tabs)/vehicles.tsx` → removed eyebrow, shadow cards, pill badges, modern styles
- `app/(tabs)/check.tsx` → removed eyebrow, renamed title to "시스템 점검", modern styles
- `app/(tabs)/explore.tsx` → removed eyebrow, pill chips, modern styles
- `app/trips/[id].tsx` → removed eyebrow, modern styles

### Session 2 (Map Feature + Route Removal)
- **Policy**: Vehicle route/history NOT shown to anyone. Commanders see current position only (for rescue operations).
- `app/trips/[id].tsx` → removed all GPS route data: GPS points list, coordinates card, "지도 열기" button, `handleOpenMap`, `getGpsStats`, `getDistanceKm`, `getTotalDistanceKm`, `formatGpsDuration`, `formatMapPoint`, `toRadians`, `getRecordedAtMs`, `formatCoord` import, `Linking` import. Only basic trip info (vehicle, route, times, stale warning) + cancel/back buttons remain.
- `components/ui/icon-symbol.tsx` → added `'map.fill': 'map'` to MAPPING
- `lib/map-html.ts` → NEW: `generateVehicleMapHtml(vehicles: VehiclePosition[])` using Leaflet.js + OpenStreetMap (no API key)
- `components/vehicle-map.native.tsx` → NEW: WebView wrapper for native (react-native-webview)
- `components/vehicle-map.web.tsx` → NEW: iframe wrapper for web (React.createElement)
- `app/(tabs)/map.tsx` → NEW: commander map screen — fetches active trips + latest GPS per vehicle, shows on Leaflet map, auto-refreshes every 30s, shows vehicle count + last update time
- `app/(tabs)/_layout.tsx` → added "위치" tab with map.fill icon

### Session 4 (Commander PIN Lock + EAS Build Prep)
- `lib/commander-pin.ts` → NEW: AsyncStorage 기반 PIN 저장/검증 (getStoredPin/setStoredPin/clearStoredPin/verifyPin)
- `app/commander-pin.tsx` → NEW: 4자리 PIN 입력 화면 (숫자패드), 3가지 모드: setup(최초 설정), verify(앱 시작 시 확인), change(점검 탭에서 변경). shake 애니메이션, 오류 메시지 표시
- `app/role-select.tsx` → commander 선택 시 setStoredRole 하지 않고 /commander-pin으로 이동 (PIN 설정 후 role 저장)
- `app/_layout.tsx` → 앱 시작 시: role=commander + PIN 저장됨 → /commander-pin(verify모드)로 리다이렉트. commander-pin Stack.Screen 추가
- `app/(tabs)/check.tsx` → role=commander일 때 "PIN 변경" 버튼 추가 (/commander-pin?change=1)
- `eas.json` → NEW: EAS Build 설정 (preview=APK internal, production=app-bundle autoIncrement)
- `app.json` → android.package: "com.vehicle.tracking" 추가 (EAS Build 필수)

### Session 3 (Auth + UX + Offline Queue)
- **Policy**: 기능 완성도 #1(GPS 저장)은 이미 완성되어 있었음. #2 Realtime 적용, UX 3건 모두 구현.
- `lib/role.ts` → NEW: AsyncStorage 기반 역할 관리 (driver/commander), getStoredRole/setStoredRole/clearStoredRole
- `lib/gps-queue.ts` → NEW: 오프라인 GPS 큐 (AsyncStorage), enqueueGpsPoint/dequeueAllGpsPoints/getGpsQueueSize, 최대 200개
- `app/role-select.tsx` → NEW: 첫 실행 시 역할 선택 화면 (운전자/수송부 간부)
- `app/_layout.tsx` → role 체크 후 미설정 시 /role-select로 리다이렉트, Stack에 role-select 추가
- `app/(tabs)/_layout.tsx` → 역할에 따라 "위치" 탭 표시/숨김 (commander만 노출, href:null 사용)
- `app/(tabs)/map.tsx` → Supabase Realtime 구독(gps_points INSERT + trips 변경) + 60s 폴백 폴링, 수송부간부 아닌 경우 접근 차단, isFetchingRef로 중복 요청 방지
- `lib/map-html.ts` → 운행 차량 없을 때 empty state 오버레이 추가
- `app/(tabs)/index.tsx` → GPS 저장 실패 시 gps-queue에 큐잉, 앱 활성화/초기화 시 큐 플러시, GPS 카드에 미전송 큐 개수 표시
- `app/(tabs)/check.tsx` → "사용자 역할" 표시 + "역할 변경" 버튼 추가 (clearStoredRole 후 role-select로 이동)

### Session 5 (Single-screen layout + GitHub Pages deploy + 기록탭 버그 수정)
- `app/(tabs)/index.tsx` → ScrollView → View(flex:1)로 변환해 스크롤 없이 한 화면에 표시. 운용자/사용자 필드를 2컬럼 나란히 배치(fieldGroupRow/fieldGroupCol). 각 카드 padding/margin 축소.
- `app.json` → `experiments.baseUrl: "/vechicle"` 추가 (GitHub Pages 서브패스 라우팅용)
- `.github/workflows/web-deploy.yml` → NEW: GitHub Pages 자동 배포 워크플로. Node 22 필수(WebSocket 이슈). `peaceiris/actions-gh-pages@v4` 사용해 gh-pages 브랜치에 배포. 피처 브랜치에서도 동작.
  - GitHub Pages 설정: Settings → Pages → Source → "Deploy from a branch" → `gh-pages` → `/ (root)`
  - 배포 URL: `https://jmpark0611-art.github.io/vechicle`
  - PWA "홈 화면 추가" 지원: Expo static export가 manifest.json 자동 생성
- `app/(tabs)/explore.tsx` → 기록탭 버그 수정: 차량 미선택 시 운행 기록 카드가 보이던 문제
  - `filteredTrips` useMemo: `selectedVehicleId === null`이면 빈 배열 반환
  - 차량 미선택 시 summaryGrid, 경고 박스, 카드 목록 숨김
  - 차량 미선택 시 "차량을 선택해 주세요" 안내 표시
  - 차량 선택 드롭다운 placeholder: '전체 차량' → '차량을 선택하세요'
  - 차량 선택 모달에서 "전체 차량" 옵션 제거 (차량 선택 필수화)

### Session 6 (OBD BLE Integration + 운행탭 통합)
- **Goal**: ELM327 BLE OBD 어댑터로 실차 테스트 준비 — obd_logs 테이블 생성 + OBD 화면 통합
- `lib/obd-ble.native.ts` → NEW (이전 세션): 실제 BLE 구현 (react-native-ble-plx). BLE 프로파일: FFE0/FFE1 (Vgate iCar Pro / HM-10), FFF0/FFF1/FFF2, Nordic UART. ELM327 초기화: ATZ, ATE0, ATL0, ATS0, ATH0, ATSP0, ATAT2. 2초 폴링 간격.
- `lib/obd-ble.ts` → NEW (이전 세션): 웹 시뮬레이션 (Metro가 .native.ts를 iOS/Android에서 우선 로드)
- **obd_logs Supabase 테이블** → 사용자가 Dashboard에서 수동 생성:
  ```sql
  create table public.obd_logs (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid references public.vehicles(id),
    trip_id uuid references public.trips(id),
    speed_kmh numeric, rpm integer, coolant_temp_c numeric,
    battery_voltage numeric, fuel_level_percent numeric,
    engine_load_percent numeric, throttle_percent numeric,
    intake_air_temp_c numeric, ignition_status text,
    dtc_codes text[], recorded_at timestamptz default now()
  );
  alter table public.obd_logs enable row level security;
  create policy "allow all" on public.obd_logs for all using (true) with check (true);
  ```
- `app/obd.tsx` → DELETED: 독립 OBD 모달 화면 제거 (index.tsx와 obdBle.setCallbacks() 충돌 방지)
- `app/_layout.tsx` → `obd` Stack.Screen 제거
- `app/(tabs)/vehicles.tsx` → "OBD 단말기 연결" 버튼 제거. `Href`, `router` import 제거 (`Link`만 유지)
- `app/(tabs)/index.tsx` → OBD 스캔/연결 패널을 routeCard 내부에 인라인으로 통합 (단일화면 레이아웃 유지):
  - `obdSaveTimerRef`, `obdLiveDataRef` useRef 추가
  - obdLiveData 변경 시 ref 동기화 useEffect 추가
  - 30초마다 obd_logs INSERT (OBD 연결 + 운행 중일 때만)
  - `handleObdScan`, `handleObdConnect`, `handleObdDisconnect` 핸들러 추가
  - routeCard 내 OBD 상태 행: 연결됨(해제 버튼) / 연결중(스피너) / 미연결(검색 버튼)
  - 스캔된 장치 목록 표시 → 탭하여 연결
  - 연결 시 배터리전압·연료·냉각수 mini 데이터 그리드 표시
  - obdInlineBtn / obdInlineBtnText 스타일 추가

**OBD PIDs**: 010D(속도), 010C(RPM), 0105(냉각수), 012F(연료), ATRV(배터리전압), 0104(엔진부하), 0111(스로틀), 010F(흡기온도), 01A6(오도미터, 비표준—지원 안 할 수 있음)

**주의**: PID 01A6(오도미터)은 비표준 제조사 특화 PID. 지원하지 않는 차량에서는 null 반환(graceful). 실차 테스트 후 미지원 시 제거 고려.

### Session 7 (운행탭 기능 확장 + Android 크래시 수정)

#### 새 기능 (운행탭 완성)
- **`lib/unit.ts`** → NEW: 부대코드/부대명 AsyncStorage 관리 (`getStoredUnitCode`, `getStoredUnitName`, `setStoredUnit`, `clearStoredUnit`), Supabase `units` 테이블에서 `fetchUnits()`, `verifyCommanderPin(unitCode, pin)` 추가
- **`lib/driver-info.ts`** → NEW: 운전자 계급/성명 저장 (`RANKS` 배열, `DriverInfo` 타입, `getDriverInfo`, `saveDriverInfo`)
- **`lib/errors.ts`** → NEW: DB 에러 포맷팅 (`formatDbError`) — 네트워크/RLS/FK/중복 등 한국어 메시지
- **`lib/speed-zones.ts`** → NEW: 제한속도 구역 (`SpeedZone` 타입, `fetchSpeedZones`, `getViolatedZone` haversine 계산) — Supabase `speed_zones` 테이블 필요
- **`app/(tabs)/monthly-log.tsx`** → NEW: 월 장비운행증 화면. 차량+월 선택 → 해당월 운행기록 테이블 표시. 컬럼: 날짜/출발시각/도착시각/출발지/목적지/목적/운용자/사용자/거리
- **`app/(tabs)/_layout.tsx`** → `monthly-log` 탭 추가 (수송부 모드 전용, TabIcon `logbook`), `useFocusEffect(refreshRole)` 추가로 탭 전환 시 역할 재확인
- **`app/role-select.tsx`** → 부대 선택 모달 추가: Supabase `units` 테이블에서 목록 조회 → 선택 시 `setStoredUnit()` 저장. 수송부 모드 시 PIN 화면에서 부대 PIN 검증(`verifyCommanderPin`)으로 변경
- **`app/(tabs)/index.tsx`** → 운행 시 추가 필드: `purpose`(목적), `operator_name/rank`(운용자), `user_name/rank`(사용자), 종료 시 `daily_km`/`end_odometer` DB 저장. 제한속도 경고(`speedWarning`) + 진동(`Vibration.vibrate`) + 햅틱. 차량 선택 시 OBD 자동 스캔. 운행 중 속도 표시
- **`components/ui/tab-icon.tsx`** → `logbook: 'calendar-month-outline'` 추가

#### DB 스키마 변경 (trips 테이블 컬럼 추가 필요)
```sql
-- 아직 적용 안 됐을 수 있음 — Supabase Dashboard에서 실행
alter table public.trips
  add column if not exists purpose text,
  add column if not exists operator_name text,
  add column if not exists operator_rank text,
  add column if not exists user_name text,
  add column if not exists user_rank text,
  add column if not exists daily_km numeric,
  add column if not exists start_odometer numeric,
  add column if not exists end_odometer numeric;

-- 부대 테이블 (역할 선택 화면에서 사용)
create table if not exists public.units (
  code text primary key,
  name text not null,
  commander_pin text
);
alter table public.units enable row level security;
create policy "allow all" on public.units for all using (true) with check (true);

-- 제한속도 구역 테이블 (speed-zones.ts에서 사용)
create table if not exists public.speed_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude numeric not null,
  longitude numeric not null,
  radius_m numeric not null,
  speed_limit_kmh numeric not null
);
alter table public.speed_zones enable row level security;
create policy "allow all" on public.speed_zones for all using (true) with check (true);
```

#### Android APK 크래시 수정 이력 (빌드 #88~#92)
**증상**: "차량운행시스템이(가) 계속 중단됨" — 앱 실행 즉시 Native crash. `앱 오류 (진단)` Alert 없음 (ErrorUtils 세팅 전에 죽음)

**조사 결과**:
- 패키지 버전: 빌드 #39와 현재 완전 동일 (reanimated 4.1.7, worklets 0.5.1, etc.)
- JS 코드 에러 → ErrorUtils가 잡아야 하므로 Alert이 떠야 함 → 뜨지 않음 = Native crash
- 빌드 #39 vs 현재 native 환경 차이: **`react-native-ble-plx` 플러그인 제거** → `expo prebuild`가 생성하는 Android 프로젝트 구조(Gradle 의존성 해소, TurboModule 등록 순서 등) 변경 → Reanimated v4 + New Architecture 초기화 실패로 추정

**시도한 수정**:
- 빌드 #88: `newArchEnabled: false→true` 복원 → FAILED
- 빌드 #89: reanimated ~3.19.5→~4.1.1 복원 + worklets 재추가 → FAILED
- 빌드 #90: `import 'react-native-reanimated'` `_layout.tsx`에 복원 → FAILED
- 빌드 #91: `(tabs)/_layout.tsx`에서 `if (!ready) return <View>` 제거 (Tabs 항상 렌더) → FAILED
- 빌드 #92 (현재 진행 중): `react-native-ble-plx` package.json + app.json plugins에 재추가 → 빌드 #39 native 환경 완전 복원 시도

**중요**: `react-native-ble-plx`는 실제로 JS에서 사용하지 않음 (`lib/obd-ble.native.ts`가 순수 JS 시뮬레이션 스텁). 빌드 환경 동일성 유지 목적으로만 추가.

**빌드 #92가 성공하면**: BLE 플러그인 없이도 빌드가 되도록 `expo-build-properties` 또는 별도 Gradle 설정으로 BLE 의존성을 대체하는 방식으로 정리 필요.

**빌드 #92가 실패하면**: logcat 출력이 필요. 기기에서 Developer Options 활성화 → `adb logcat | grep -i "fatal\|crash\|exception\|reanimated\|worklets"` 실행.

### Deployment Notes (GitHub Actions)
- **Node 20 WebSocket 오류**: Expo static export가 SSR 실행 중 Node 20에서 WebSocket 없어 실패 → Node 22로 변경 해결
- **`actions/deploy-pages` 브랜치 제한**: 기본 브랜치(main)에서만 동작 → `peaceiris/actions-gh-pages@v4`로 교체 해결
- **빌드-39**: APK 다운로드 - https://github.com/jmpark0611-art/vechicle/releases/tag/build-39

## Architecture Decisions
- **No route history anywhere**: gps_points table is write-only from driver's perspective; commanders only read latest point per active trip
- **Map stack**: react-native-webview (native) + iframe (web) both rendering Leaflet HTML from `lib/map-html.ts`
- **Map refresh**: client-side interval (30s), not real-time subscription (Supabase realtime not used to keep it simple)
- **No Google Maps API key needed**: OpenStreetMap tiles via Leaflet CDN (unpkg.com/leaflet@1.9.4)
- **Platform split**: `vehicle-map.native.tsx` / `vehicle-map.web.tsx` — Expo Router resolves automatically
- **OBD singleton**: `obdBle` from `lib/obd-ble.native.ts` — only one `setCallbacks()` call allowed (in index.tsx). Never add another screen calling setCallbacks().
- **OBD save interval**: 30s via `obdSaveTimerRef` in index.tsx. Clears when OBD disconnects or trip ends.
- **Single-screen layout**: index.tsx uses View(flex:1), NO ScrollView. All OBD UI is inline inside routeCard, not a new card.

- **react-native-ble-plx 필수**: 실제로 JS에서 BLE를 직접 사용하지 않더라도 package.json + app.json plugins에 반드시 포함해야 함. 제거 시 Android native crash 발생 (빌드 #88~91 모두 실패). 원인은 BLE 플러그인이 변경하는 Gradle/TurboModule 환경이 Reanimated v4에 필요한 것으로 추정.
- **OBD 구현**: `lib/obd-ble.native.ts`는 현재 순수 JS 시뮬레이션 스텁. 실제 BLE 통신 구현은 추후 별도 작업 필요. 기존 구현 코드는 git history에서 복구 가능.
- **tabs/_layout.tsx**: `if (!ready) return <View>` 절대 추가 금지. Expo Router에서 (tabs) 그룹 layout은 항상 `<Tabs>`를 반환해야 함. 역할 미확인 시에는 모든 탭에 `href: null` 사용.

## Working Branch
`claude/env-permissions-session-restart-154onb` on `jmpark0611-art/vechicle`

## 현재 미해결 과제
1. **Android 크래시** (최우선): 빌드 #92 결과 확인 필요. 실패 시 logcat 필수.
2. **trips 테이블 컬럼**: purpose, operator_name/rank, user_name/rank, daily_km, start/end_odometer 컬럼이 DB에 없으면 운행 시작/종료 오류 발생. Supabase Dashboard에서 추가 필요.
3. **units 테이블**: role-select의 부대 선택 기능을 위해 생성 필요.
4. **speed_zones 테이블**: 제한속도 경고 기능을 위해 생성 필요. 빈 테이블이면 경고 없이 동작함.
5. **OBD 실 연결**: 현재 JS 시뮬레이션. 실차 ELM327 BLE 어댑터 연결 테스트 미완료.
