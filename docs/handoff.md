# 인수인계 메모

## 2026-07-15 latest handoff

- Current branch: `claude/env-permissions-session-restart-154onb`.
- 2026-07-17 role selection / fleet alert tab:
  - Commander tab label changed from `알림` to `정비`.
  - Periodic replacement cards were removed from `app/(tabs)/vehicles.tsx` and moved to `app/(tabs)/alerts.tsx` under `차량 설정`, below the alert list. Diagnosis now focuses on ECU/OBD sensor information.
  - `app/(tabs)/vehicles.tsx` now places `차량 등록` as a compact top-right pill on the diagnosis screen. `ECU 감지 정보` and `주기성 교환품목` headings are larger and color-separated for clearer scanning.
  - `app/role-select.tsx` now presents the app as `차량 운행관리`, with taller mode cards and more breathing room between title and guidance text.
  - Added commander-only `app/(tabs)/alerts.tsx` and a matching `알림` bottom tab.
  - The alert tab aggregates all vehicles with periodic replacement due/overdue items and ECU inspection alerts from the latest OBD snapshot.
  - ECU alert thresholds are first-pass operational rules: DTC > 0, coolant >= 105°C, battery outside 12~15V, fuel <= 15%, engine load >= 90%, short/long fuel trim absolute value >= 20%, and emissions readiness not `준비 완료`.
  - `교체완료` reuses the existing maintenance baseline save/sync path. `점검완료` stores an acknowledgement fingerprint locally, so the same ECU value is hidden but a changed value appears again.
  - `lib/fleet-alerts.ts` adds commander-side live OBD popups for the same ECU thresholds. These popups are wired only in `app/(tabs)/vehicles.tsx`; driver trip mode intentionally does not show maintenance popups.
  - Driver trip mode still feeds commander visibility: `app/(tabs)/index.tsx` saves latest OBD live data to the shared local OBD snapshot every 30 seconds via `buildObdReadingFromLiveData()` + `saveLocalObdReading()`, so the commander `알림` tab can show detected issues.
- 2026-07-17 VIN / emissions readiness OBD support:
  - `ObdLiveData` and `ObdReading` now include VIN, readiness summary, intake temp, throttle percent, engine load, MAP, short/long fuel trims, oxygen sensor voltage, and DTC count.
  - `lib/obd-ble.native.ts` polls inspection-related PIDs: `0101` readiness/DTC count, `0104`, `0106`, `0107`, `010B`, `010F`, `0111`, `0114`, and `0902` VIN.
  - `app/(tabs)/vehicles.tsx` now shows real values for those fields when supported, otherwise `미수신`.
  - Supabase schema has not yet been extended for the new extra OBD columns; current DB writes remain on existing stable columns, while local snapshot/UI can carry the extended fields.
  - `npm.cmd run verify` passed.
- 2026-07-17 expanded diagnosis / maintenance:
  - Removed the duplicated square `ECU 상태` card from `app/(tabs)/vehicles.tsx`; the top horizontal ECU status bar remains.
  - Diagnosis cards now show live-supported OBD fields first: RPM, OBD speed, coolant, battery, fuel, and DTC count.
  - Additional OBD capability placeholders are visible for later PID work: intake temp, throttle, engine load, fuel trim, MAP, oxygen sensor, VIN, and readiness.
  - `lib/maintenance-data.ts` now includes more periodic items: fuel filter, coolant, brake oil, transmission oil, power steering oil, battery, tire, brake pad, wiper blade, spark plug, and timing belt.
  - `npm.cmd run verify` passed.
- 2026-07-17 active trip odometer wording:
  - `app/(tabs)/index.tsx` active trip stat now says `계기판 누적거리` instead of `출발 km`.
  - If `activeTrip.startOdometer` is missing, the UI falls back to the selected vehicle's current odometer baseline.
  - The destination odometer auto hint uses the same baseline.
  - `npm.cmd run verify` passed.
- 2026-07-17 diagnosis ECU bar / trip completion isolation:
  - `app/(tabs)/vehicles.tsx` replaces the old selected vehicle/current-km strip with a horizontal `ECU 감지 상태` bar above the ECU cards.
  - `app/(tabs)/index.tsx` captures the first live OBD fuel percentage as the trip fuel baseline if OBD connects after the trip starts.
  - Active trip cards now show current fuel and consumed fuel percentage.
  - Completed trip summary no longer renders the new-trip input form underneath; `새 운행 입력` clears the summary and returns to the start form.
  - `npm.cmd run verify` passed.
- 2026-07-17 speed tab live overspeed alert:
  - Commander `위치` tab/screen has been renamed to `속도`.
  - `app/(tabs)/map.tsx` polls `fetchLocationSnapshot()` every 10 seconds while the speed screen is mounted, so overspeed alerts do not depend on manual refresh.
  - Overspeed alerts now trigger a stronger `Vibration` pattern and an Android system `Alert`. There is no dedicated audio module in the app right now; a guaranteed custom warning sound would require adding and validating a native module such as Expo audio/notifications in a separate APK build.
  - `npm.cmd run verify` passed.
- 2026-07-17 stronger diagnosis compact layout:
  - Replaced the selected-vehicle `SectionCard title=""` wrapper with a custom `diagnosisPanel` to remove the leftover blank title area.
  - ECU cards now use a lower 96px min-height; maintenance cards use a separate 116px min-height for the action button.
  - `npm.cmd run verify` passed.
- 2026-07-17 compact diagnosis cards:
  - Diagnosis selected-vehicle area now uses a single horizontal info bar with vehicle number, `현재 기준`, and current km.
  - ECU/maintenance cards changed from square cards to shorter rectangular cards to reduce vertical scrolling.
  - `npm.cmd run verify` passed.
- 2026-07-17 automatic OBD retry on trip screen:
  - Trip screen now displays actual OBD auto-connection state instead of a fixed `대기` label.
  - While a trip is active, it automatically connects to the saved OBD device.
  - If no saved device exists, it scans for OBD candidates, saves the first candidate, and connects.
  - Failed/disconnected OBD connections are retried every 12 seconds during the trip.
  - `npm.cmd run verify` passed.
- 2026-07-17 trip completion auto summary:
  - Active trip UI removed manual destination odometer input.
  - Completion saves a final GPS point, reads GPS trip distance, and estimates end odometer as start odometer + GPS distance when no direct OBD odometer PID is available.
  - Trip completion shows a `안전운행해주셔서 감사합니다` summary card with monthly log fields: vehicle, route, start/end time, odometer total/trip distance, GPS distance, fuel used, purpose, operator, and user.
  - Fuel used is percentage-based from OBD fuel start/end values when available; exact liters still require vehicle tank capacity or a reliable fuel-use PID.
  - Full-screen location map modal now applies safe-area top padding to avoid title/status overlap.
  - `npm.cmd run verify` passed.
- 2026-07-17 tab title only / compact trip form:
  - Removed top-right role/mode switching pill from the common header; mode changes should happen only through explicit role selection flows.
  - Common header now displays only the active tab name in a larger blue title, not `차량운행시스템`.
  - Trip tab removed duplicate odometer/OBD summary cards, uses compact vehicle dropdown, and reduced card/input heights so the form sits higher and is closer to one-screen use.
  - Diagnosis tab removed the circled manual current-km input/save block; current km is shown as a read-only pill.
  - `npm.cmd run verify` passed.
- 2026-07-17 stable APK download:
  - Android workflow updates a fixed `latest-apk` release on every successful APK build.
  - Use this stable direct URL for users: `https://github.com/jmpark0611-art/vechicle/releases/download/latest-apk/app-release.apk`.
  - Web deploy also publishes a visible button page: `https://jmpark0611-art.github.io/vechicle/download.html`.
  - After this workflow change is pushed, the stable links become valid once the next Android APK and Pages workflows complete.
- 2026-07-17 trip home redesign / direct mode switch:
  - Common header now looks like a compact brand header (`차량운행시스템`) with the tab title as a smaller secondary line, matching the user's reference direction more closely than the old plain title.
  - Right-side role pill is the mode action: driver -> commander PIN, commander -> driver mode directly. No separate gear/radar button is shown.
  - Trip tab now uses a dark hero card, summary cards, grouped `차량/인원/운행 정보` cards, and an in-screen start/end button.
  - Records popup/export now include `소모한 유류`, calculated as first OBD fuel percentage minus last OBD fuel percentage for that trip. This is percentage-based until vehicle fuel tank capacity is modeled.
  - `npm.cmd run verify` passed.
- 2026-07-17 tab header/location polish:
  - `components/rebuild-screen.tsx` now renders a small icon pill header across tabs and makes the `운전자/수송부` role pill open mode settings; the old separate gear/radar-looking button is removed.
  - Trip primary action no longer uses `marginTop: 'auto'`, reducing the large blank space above the tab bar.
  - Commander PIN success routes to `/(tabs)/explore`, and `app/(tabs)/index.tsx` redirects commanders away from the trip screen if a cached route opens it.
  - Location speed-zone form uses a one-line zone name/speed-limit input row, button text `구역 설정`, no undo buttons, and remounts the full map on reset so vertices clear reliably.
  - Records currently show odometer total, odometer trip distance, GPS actual distance, OBD fuel percentage, and inferred refuel events in the detail popup/export; exact consumed-fuel quantity still depends on reliable OBD fuel-use PID support.
  - `npm.cmd run verify` passed.
- 2026-07-17 speed-zone integer save fix:
  - User reported polygon zone save failing with `invalid input syntax for type integer: "470.8712088862511"`.
  - `lib/location-data.ts` now rounds computed polygon radius meters and speed-limit values before inserting into `speed_zones`, so deployed Supabase tables with integer columns accept the save.
  - `npm.cmd run verify` passed.
- 2026-07-17 visible UI refresh:
  - Mode selection now uses emoji icons (`🚐`, `▶️`, `🛠️`) instead of Korean letters in icon blocks.
  - Mode cards were visually refreshed with softer pastel surfaces and tighter copy.
  - `RebuildScreen` uses `flexGrow` and pushes the primary action button toward the bottom of the available screen, reducing the large empty gap on the trip screen.
  - Trip input spacing and field heights were tightened.
  - `npm.cmd run verify` passed.
- 2026-07-16 strict role tabs/PIN update:
  - Driver mode displays only the `운행` tab.
  - Commander mode displays `기록`, `진단`, `위치`, `점검`; the `운행` tab is hidden.
  - Commander access still goes through `commander-pin`, and the accepted PIN is fixed to `1862`.
  - Existing stored PIN values are ignored; PIN change UI was removed from settings/check surfaces.
  - `npm.cmd run verify` passed.
- 2026-07-16 launch/header update:
  - App startup now depends on the Stack `initialRouteName: 'role-select'`; no root-layout forced `router.replace` is used.
  - `app/index.tsx` explicitly redirects `/` to `/role-select` so the APK first screen is mode selection.
  - Common headers are smaller line-style headers to reduce the oversized tab-title look.
  - Primary action buttons are rendered inside scroll content, not in a fixed footer, to remove the large empty gap above the tab bar.
  - `npm.cmd run verify` passed.
- 2026-07-16 distance/log update:
  - Records popup distinguishes `계기판 총 주행거리`, `계기판 운행거리`, and `실제 이동거리`.
  - `lib/gps-data.ts` calculates per-trip actual movement distance from saved `gps_points`; no DB migration is required.
  - Monthly equipment operation log is now shaped as daily/operation rows using trip-screen data: route content, operator/user rank+name, odometer total, odometer trip distance, and GPS actual distance.
  - `npm.cmd run verify` passed.
- 2026-07-16 trip UX/stability update:
  - The `expo-notifications` experiment was removed after the user reported the APK closing immediately on launch.
  - `app/_layout.tsx` was restored to the safer stored-role check instead of forced startup navigation.
  - `components/rebuild-screen.tsx` now uses a pastel header card and smaller bottom padding to reduce the blank space above the tab bar.
  - Trip completion/cancel clears end-place, odometer, purpose, and temporary end-odometer inputs.
  - `npm.cmd run verify` passed.
- Latest commander diagnosis/records update:
  - Diagnosis tab has a `단말기 연결` button beside vehicle selection. It reuses the saved BLE OBD device if present, otherwise scans and stores the first OBD candidate.
  - Live OBD frames update the selected vehicle's diagnosis cards and save a synced OBD reading every 30 seconds while connected.
  - Diagnosis cards are split into `ECU 감지 정보` and `주기성 교환품목` groups, two square cards per row.
  - Records tab list is intentionally minimal: date, vehicle, and route only. Tap a record for the detail popup used by the monthly equipment operation log.
  - Monthly export includes operator/user rank+name, latest fuel percentage, and inferred refuel events when OBD fuel percentage increases by 8% or more inside the current month.
  - Trip start odometer is auto-filled from the selected vehicle's synced current km. Generic ELM327 adapters usually do not expose total odometer, so this remains app/synced-km based unless a vehicle-specific PID is added later.
  - `lib/obd-data.ts` now uses Supabase `obd_logs.fuel_level_percent`; keep `docs/schema.sql` applied before relying on fuel/refuel data.
  - `npm.cmd run verify` passed.
- Latest pastel diagnosis UI:
  - `vehicles` tab title is now shown as `진단`.
  - Diagnosis screen uses two-column square cards for ECU/OBD readings and periodic maintenance items.
  - Common screen shell and tab bar were retuned to a pastel palette.
  - `npm.cmd run verify` passed.
- Latest UX cleanup:
  - Location tab: polygon-only setup, save button in full-screen map footer, removed visible speed-alert/active-vehicle sections, keeps registered speed-zone list, and vibrates/alerts on overspeed while open.
  - Vehicle tab: registration moved to modal with vehicle number/type/initial odometer fields; inline vehicle-number input removed.
  - Records tab: monthly equipment operation log export uses React Native Share.
  - Trip tab: compact driver/user rank+name rows, same-as-driver checkbox, simplified vehicle dropdown copy.
  - `npm.cmd run verify` passed.
- Latest task: convert speed-limit zone setup from point-only to area-capable.
- Implemented:
  - `app/(tabs)/map.tsx`: polygon/circle mode selector, map vertex tapping, undo, clear, polygon preview, and save validation.
  - `lib/map-html.ts`: Leaflet/OpenStreetMap rendering for polygon zones, circle zones, active vehicles, and polygon draft vertices.
  - `lib/location-data.ts`: polygon zone persistence, old-schema fallback, point-in-polygon alert checks, and clean Korean errors.
  - `components/vehicle-map.web.tsx`: web parity for `mapCenter` messages.
  - `docs/schema.sql`: `speed_zones.zone_kind` and `speed_zones.polygon_points` migration.
- Important DB step before polygon saving works in production: apply the updated `docs/schema.sql` speed_zones migration in Supabase SQL Editor. Without it, old circle zones still load, but polygon save shows a DB-column-needed alert.
- Verification: `npm.cmd run verify` passed.
- Follow-up fix in the same area:
  - Zone selection now opens a full-screen modal map.
  - The preview map is no longer used for point placement.
  - Leaflet draft points are managed inside the WebView while tapping, so the map should not reload/zoom out after every point.
  - Double-click zoom is disabled during zone selection to reduce accidental zooming.
  - Save error wording now clearly says when the Supabase polygon columns are missing.

## 2026-07-14 current branch status

- Active branch: `rebuild/clean-sdk54-start`
- Known-good installed APK before this step: `apk-29255828399`
  - Release page: `https://github.com/jmpark0611-art/vechicle/releases/tag/apk-29255828399`
  - APK: `https://github.com/jmpark0611-art/vechicle/releases/download/apk-29255828399/app-release.apk`
- Current direction: rebuild features in small APK-testable steps and avoid adding risky native modules until the app launch path stays stable.
- Latest implemented step: OBD manual diagnostic records.
  - Added `lib/obd-data.ts`.
  - Vehicle tab can save RPM, speed, coolant temperature, battery voltage, fuel percentage, and DTC count per vehicle.
  - Data is saved to AsyncStorage first and attempts Supabase insert into `obd_logs`.
  - `docs/schema.sql` now includes `obd_logs` plus RLS policies.
  - Check tab includes `obd_logs` table diagnostics.
- Important: no real Bluetooth/BLE package was added in this step. Real ELM327/OBD scanner connection should be added later in a separate branch/commit/APK after this manual UI/data path is confirmed on device.
- Follow-up implemented step: speed-zone alert preview.
  - `lib/location-data.ts` calculates distance between active vehicle GPS points and registered speed zones.
  - Location tab shows vehicles inside speed zones and marks records as `초과 의심` when speed exceeds the zone limit.
  - This still uses only existing Supabase data and adds no native module or permission.
- Experimental branch now in progress: `feature/obd-ble-elm327-probe`.
  - Adds `react-native-ble-plx` and Android Bluetooth permissions.
  - Vehicle tab has an `OBD BLE 스캐너` panel for BLE scan and local selected-device storage.
  - BLE manager is created only after pressing the scan button, not during app startup.
  - This branch must be APK-tested separately from the stable `rebuild/clean-sdk54-start` branch.
  - Next step after device confirms app opens: test whether the user's scanner appears in BLE scan. If not, it is likely Classic Bluetooth and needs a different native approach.

## 2026-07-14 latest handoff for next AI

- Current local/remote branch: `feature/obd-ble-elm327-probe`
- Latest commits:
  - `1ac7a94 feat: add experimental obd ble scanner search`
  - `111ab2d ci: build obd ble experiment branch`
- Latest experimental BLE APK build succeeded:
  - Run: `29292928878`
  - Release: `https://github.com/jmpark0611-art/vechicle/releases/tag/apk-29292928878`
  - APK: `https://github.com/jmpark0611-art/vechicle/releases/download/apk-29292928878/app-release.apk`
- Last stable non-BLE APK remains available:
  - Release: `https://github.com/jmpark0611-art/vechicle/releases/tag/apk-29286648719`
  - APK: `https://github.com/jmpark0611-art/vechicle/releases/download/apk-29286648719/app-release.apk`
- User should test the BLE APK in this order:
  1. Install `apk-29292928878` and confirm the app opens.
  2. Go to the vehicle/diagnosis tab.
  3. Press `OBD BLE 스캐너 검색`.
  4. Allow Bluetooth permissions.
  5. Report whether the scanner appears in the list.
- If the scanner appears:
  - Next work is ELM327 connect/init probe: connect to the selected BLE device, discover services/characteristics, then try safe AT commands (`ATZ`, `ATE0`, `ATL0`, `ATS0`, `010C`, `010D`) behind a user button.
- If the scanner does not appear:
  - It is probably Classic Bluetooth rather than BLE.
  - Do not keep changing the current BLE branch blindly.
  - Next AI should inspect the scanner model/photo and consider a Classic Bluetooth serial approach or a user-facing note that the current APK supports BLE adapters only.
- Safety rule:
  - Do not merge `feature/obd-ble-elm327-probe` into the stable branch until the user confirms the BLE APK opens normally on the device.

## 2026-07-07 최신 APK 다운로드 상태

- 최신 release APK 빌드는 성공 완료됐다.
- GitHub Actions run: `28795041514`
  - URL: `https://github.com/jmpark0611-art/vechicle/actions/runs/28795041514`
  - head SHA: `bb411cc3913d506b647a47a7fe9fc0e1d06572b3`
  - artifact ID: `8110995186`
  - artifact name: `vehicle-system-release-apk`
  - artifact size: 약 40.7MB
  - artifact expires: `2026-10-04T13:26:58Z`
- 설치 테스트 시 반드시 기존 debug APK 앱을 삭제한 뒤 `vehicle-system-release-apk` 안의 `.apk`를 설치한다.
- 사용자가 모바일 GitHub에서 Artifacts가 안 보인다고 했다. 이 경우 Actions run 페이지를 Chrome/브라우저에서 데스크톱 사이트로 열거나, GitHub 로그인 상태에서 artifact URL을 직접 열게 안내한다.
- GitHub artifact 직접 경로: `https://github.com/jmpark0611-art/vechicle/actions/runs/28795041514/artifacts/8110995186`
- 주의: Codex/GitHub MCP가 생성하는 `sdmnt...` 직접 다운로드 URL은 임시 링크라 만료될 수 있다. 만료되면 artifact ID `8110995186`로 다시 다운로드 링크를 생성해야 한다.
- `25ef841` LinearGradient 커밋은 현재 최신 브랜치 히스토리에 포함되어 있다. 따라서 `bb411cc` 기반 release APK에는 LinearGradient 히어로 카드 변경이 포함된다.

## 2026-07-06 APK / 스플래시 이슈 인수인계

- 현재 작업 브랜치: `claude/env-permissions-session-restart-154onb`
- GitHub repo: `jmpark0611-art/vechicle`
- 사용자가 처음 받은 artifact는 `vehicle-system-debug-apk`였고, 실기기에서 Expo 기본 스플래시 화면에 멈췄다.
- 원인 판단: `assembleDebug` APK는 단독 실행용 release APK가 아니어서 JS 번들이 포함되지 않거나 Metro 개발 서버 의존 상태가 되어 실기기에서 스플래시 화면에 머물 수 있다.
- 대응 완료 커밋:
  - `b90338e` `Align vehicle diagnosis with demo`
  - `46aee12` `Build Android APK with GitHub Actions`
  - `d988cdb` `Stabilize GitHub APK build`
  - `954c54a` `Build standalone release APK`
- 최신 워크플로는 `.github/workflows/eas-build.yml`에서 `npx expo prebuild --platform android --no-install` 후 `./gradlew :app:assembleRelease --no-daemon --stacktrace`를 실행하고 `vehicle-system-release-apk` artifact를 업로드한다.
- 최신 release APK run: `28794479728`
  - URL: `https://github.com/jmpark0611-art/vechicle/actions/runs/28794479728`
  - 2026-07-06 22:18 KST 기준 `Build release APK` 진행 중이었다.
- 다음 AI는 먼저 run `28794479728` 완료 여부를 확인한다. 성공하면 artifact `vehicle-system-release-apk`를 사용자에게 안내한다. 실패하면 job 로그의 `Build release APK` 단계 오류를 확인한다.
- 사용자가 설치 테스트할 때는 기존 debug APK 앱을 삭제한 뒤 release APK를 설치하게 안내한다.
- `npm.cmd run verify`는 통과한다. 남은 경고는 `app/(tabs)/index.tsx`의 기존 미사용 음성/OBD 상태 변수 5건이다.

## 최신 작업 메모

- 현재 브랜치: `claude/env-permissions-session-restart-154onb`
- 최신 작업 방향: 데모 HTML/APK 동등성 유지. 라이트/딥네이비 UI 기준이며 과거 다크라임 UI는 기준이 아니다.
- 차량 진단 화면은 333 첨부 화면을 기준으로 1차 정리했다. OBD 상태, ECU 데이터, DTC, 소모품 교환주기를 상단 흐름에 배치했고 기존 차량 관리 기능은 삭제하지 않고 유지했다.
- 다음 우선순위는 위치 화면(555 기준) 시각 정리, 이후 실제 기기 APK에서 운행/기록/차량/위치 탭의 화면 잘림과 입력 흐름 확인이다.
- 검증: `npm.cmd run verify` 통과. 운행 탭 `app/(tabs)/index.tsx`에 기존 미사용 변수 경고 5건이 남아 있다.

## 프로젝트

- 앱 이름: 차량운행시스템
- 기반: Expo SDK 54, Expo Router, Supabase
- 주요 경로: `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `app/(tabs)/vehicles.tsx`, `app/(tabs)/check.tsx`, `app/trips/[id].tsx`
- 현재 작업 브랜치: `claude/env-permissions-session-restart-154onb`
- 현재 UI 기준: `Vehicle system UI improvement.zip`의 라이트/딥네이비 하이파이 디자인. 과거 다크+라임 UI는 기준에서 제외한다.
- 데모와 APK의 화면/기능 동등성 기준은 `docs/demo-parity.md`를 따른다.

## 현재 화면

- `역할 선택`: 중앙 로고, `운행 모드`/`수송부 모드` 카드, 테마 점 UI. 수송부 모드는 PIN 화면으로 이동한다.
- `운행`: 라이트/딥네이비 디자인 기준. 대기 화면은 `차량 선택` → `운행 정보` → `경로` 카드 순서이며, 운용자·사용자 성명 입력 후 출발 가능. 진행 중 화면은 LinearGradient 히어로 카드로 속도/경과/경로/OBD 요약을 표시한다.
- `기록`: 30건 단위 더 보기 목록, 상태/기간/차량 필터, 검색, 필터 결과 요약 통계, 웹 CSV 내보내기, GPS 요약, GPS 누락 경고, 장시간 미종료 경고
- `차량`: 차량 등록/수정/삭제, 차량번호 중복 선검사, 삭제 전 DB 운행 기록 재확인, 차량별 exact 운행 수, 검색/상태 필터, 요약 통계, 차량별 운행 상태, 중복 미종료 운행 경고
- `OBD`: `/obd` 단독 화면에서 BLE 단말기 연결과 진단 데이터를 처리한다. 운행 시작 전 화면에는 OBD 진단 카드를 두지 않는다.
- `점검`: 앱/SDK 버전, Supabase 연결/카운트/GPS/최근 GPS 경과/중복 진행 운행/진행 운행 표시 수/실기기 확인 안내
- `운행 상세`: 좌표, GPS 요약, 평균/최고 속도, GPS 수집 구간, GPS 품질 안내, 최근 GPS 기록, 지도 열기, 진행 중 운행 무효 처리

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

## 주의점

- GitHub 레포/브랜치로 넘길 때는 `docs/github-handoff.md`를 먼저 확인한다.
- Expo 템플릿의 `reset-project` 스크립트는 업무 앱 파일을 삭제할 수 있어 제거했다. 다시 생기면 `npm.cmd run source-check`가 실패한다.
- 사용하지 않는 Expo 템플릿 모달 라우트와 `app-example` 폴더도 source-check에서 막는다.
- 사용하지 않는 기본 템플릿 컴포넌트는 정리했고, 현재 탭 UI는 `components/haptic-tab.tsx`와 `components/ui/icon-symbol.tsx`를 사용한다.
- 기록 화면은 기본 30건을 조회하고 `운행 기록 더 보기`로 30건씩 확장한다. CSV 내보내기는 현재 웹 브라우저에서 동작하며, Expo Go 네이티브 파일 저장은 별도 모듈이 필요하다.
- 기록 화면의 기간/차량 필터는 검색어가 없어도 적용되며, 완료 운행인데 GPS 포인트가 없으면 GPS 누락으로 표시한다.
- 차량 화면의 전체/완료/미종료 운행 수는 차량별 Supabase exact count로 계산한다. 최근 운행 링크와 장시간 표시용 운행 목록은 최근 100건 기준이다.
- 점검 화면의 진행 중 운행 목록은 최근 10건을 보여주고, 전체 진행 운행 수가 더 많으면 표시 수 안내를 함께 보여준다.
- 운행 상세는 GPS 기록 전체 개수를 보여주되, 화면에는 최근 50개까지만 표시한다. 표시된 GPS 기준으로 추정 거리, 평균/최고 속도, 첫/최근 GPS, GPS 수집 구간을 계산한다.
- Android Expo Go에서는 네이티브 음성 인식 모듈이 기본 포함되지 않으므로 현재 음성 입력은 웹 브라우저 중심이다. 브라우저에서는 권한 차단, 음성 미감지, 마이크 장치 오류를 운행 화면 안내 박스로 표시한다. `app.json`에는 추후 개발 빌드 확장을 대비해 위치/마이크 권한 문구를 명시해 두었다.
- 주요 ScrollView 화면은 `useSafeAreaInsets`로 상단 노치와 하단 홈 인디케이터/탭바 여백을 반영한다. 새 화면을 추가할 때도 고정 `paddingTop` 대신 안전영역 기반 여백을 사용한다.
- 작은 Android/iPhone 폭에서 텍스트와 버튼이 잘리지 않도록 툴바, 카드 헤더, 정보 행, 주요 액션 행은 `flexWrap`과 `gap`을 사용한다.
- 긴 차량번호/장소/요약 값은 `numberOfLines`, `adjustsFontSizeToFit`, `minWidth: 0`으로 모바일 폭 안에 머물도록 처리한다.
- 기록/차량 필터 바는 작은 화면에서 2열로 감기도록 `flexBasis`와 `flexWrap`을 사용한다.
- 진행 중 운행이 이미 있으면 운행 시작 시 새 운행을 만들지 않고 기존 운행을 복구한다.
- 운행 화면은 최신 GPS 좌표를 ref로 보관해 위치 변경 때마다 대시보드 복구 로직이 불필요하게 재생성되지 않도록 했다.
- Supabase 요청은 `lib/request.ts`의 `withTimeout`을 거치며, 완료 후 내부 타이머를 정리한다.
# 2026-07-15 handoff: odometer sync from trips

- Added durable odometer sync because local maintenance `currentKm` can reset after APK reinstall or device changes.
- `fetchLatestVehicleOdometers(vehicleIds)` reads the latest `end_odometer`, falling back to `start_odometer`, from Supabase `trips`.
- `mergeVehicleCurrentKm(snapshot, vehicleKm)` merges newer/larger trip odometer values into the maintenance snapshot and saves it locally.
- Vehicle tab and trip tab now both apply this merge during load.
- Important product note: ELM327/OBD does not reliably expose dashboard total odometer through a standard PID. For now, durable automatic reflection means app-recorded trip odometer values, not direct cluster odometer reading.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: remove wiper maintenance item

- User requested removing `와이퍼` from the 정비 tab.
- Implemented by deleting `wiperBlade` from `MaintenanceKey` and `MAINTENANCE_ITEMS` in `lib/maintenance-data.ts`.
- This removes it from both maintenance cards and generated maintenance alerts.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: diagnosis and maintenance balance fix

- User feedback:
  - Diagnosis screen became too shrunken; ECU inner cards should fill the screen again.
  - Maintenance cards became too large; revert closer to the previous compact card size.
  - Engine oil, oil filter, air filter, and fuel filter are commonly replaced together and should be grouped.
- Implemented:
  - Diagnosis ECU card min height and typography increased again.
  - Maintenance card height/text/button sizes reduced back.
  - `MAINTENANCE_ITEMS` now exposes `엔진오일 세트` instead of four separate oil/filter cards.
  - Legacy local/DB keys `engineOil`, `oilFilter`, `airFilter`, `fuelFilter` normalize to `engineOilSet`.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: internal driver card sizing

- User clarified the issue: the outer active-trip card was enlarged, but the inner cards stayed short, creating empty white space.
- Implemented in `app/(tabs)/index.tsx`:
  - route panel min height increased,
  - stat cards min height increased,
  - OBD strip min height increased,
  - auto-odometer panel min height increased,
  - active-trip flexible spacer no longer consumes the remaining blank area,
  - completion green summary card uses `flex: 1` and each summary row has a larger min height.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: larger driver and maintenance cards

- User clarified the recent request was not just "fit more"; for the relevant screenshots the desired fix is larger text and taller cards.
- Implemented:
  - Larger active driver screen title/value typography.
  - Taller active trip route, stat, OBD, auto-odometer, and action sections.
  - Larger completion-summary title/row fonts and spacing.
  - Taller maintenance cards in 정비 tab with larger value/detail/button text.
  - Removed leftover unused `ecuStatusBar` styles from diagnosis to avoid confusion with the old `ECU 감지 상태 / 미감지` design.
- Note: if the APK still shows the old diagnosis `ECU 감지 상태` bar, the installed APK is not built from this branch after commit `1d84b62` or later.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: driver fullscreen state layout

- User reported the previous active/completion layout still looked clustered at the top.
- Root cause: adjusting `minHeight` inside the shared `RebuildScreen` scroll container was not enough for the real Android layout.
- Implemented a stronger fix:
  - `app/(tabs)/index.tsx` now returns a dedicated non-scroll full-screen layout for active trip state.
  - Trip card uses `flex: 1` to fill the remaining screen.
  - Trip completion state also returns a dedicated full-screen layout with `justifyContent: 'space-between'`.
- Keep future active/completion driver changes in this dedicated branch, not inside the shared scroll screen.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: driver active screen fill fix

- User reported the active/completion driver screens still looked clustered at the top with a large lower blank area.
- Implemented a stronger fill fix in `app/(tabs)/index.tsx`:
  - active trip card min height increased to near full screen,
  - added `tripFlexibleSpace` before the cancel/end action row,
  - completion summary wrapper now uses a larger min height and `justifyContent: 'space-between'`.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: missed layout fixes

- User reported the previous APK still showed:
  - large lower blank space on active driver trip screen,
  - diagnosis screen not fitting one viewport,
  - `ECU 감지 상태 / 미감지` bar taking too much room,
  - maintenance `새로고침` button overlapping the bottom tab bar.
- Implemented:
  - Active/completion driver screens now use a near-full-screen wrapper so the content fills the phone instead of leaving a blank lower half.
  - Diagnosis dropdown displays muted `차량 선택` text while keeping the selected vehicle id internally.
  - Removed diagnosis `ECU 감지 상태` status bar; compact status now appears beside the `ECU 감지 정보` heading as `ECU 감지` or `연결 전`.
  - Primary diagnosis ECU grid now shows the first eight live cards with reduced card height.
  - Maintenance tab removed its lower refresh action to avoid tab overlap.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 handoff: compact mobile layout pass

- Current branch: `claude/env-permissions-session-restart-154onb`.
- User feedback: mode selection cards should be taller; driver mode should not show the bottom 운행 tab; active/completion driver screens, speed tab, and diagnosis tab should minimize lower whitespace and fit more on one phone screen.
- Implemented:
  - Driver mode tab bar is hidden via `app/(tabs)/_layout.tsx`.
  - `components/rebuild-screen.tsx` now accepts `bottomSpace="none" | "compact" | "tab"`.
  - Driver trip screen uses `bottomSpace="none"` and tighter active/completion card spacing.
  - Speed and diagnosis screens use `bottomSpace="compact"`.
  - Speed screen removes the lower refresh action, reduces map/input heights, and limits the visible zone preview to two items plus a count.
  - Diagnosis screen removes the lower refresh action and lowers ECU card height.
  - Role select mode cards are taller with right-side role badges (`운전자용`, `관리자용`).
- Verification passed with `npm.cmd run verify`.

# 2026-07-15 handoff: active trip button flow

- Driver trip screen now branches by active-trip state.
- No active trip: show vehicle/operator/route/odometer form and bottom button `운행 시작`.
- Active trip: hide the start form, show a single `운행 중` card, and bottom button becomes `운행 종료`.
- Removed the `진행 중 운행 N건` heading from driver mode.
- Secondary `운행 취소` stays inside the active trip card.
- Verification passed with `npm.cmd run verify`.

# 2026-07-14 handoff: vehicle workflow refinement

- Map drag issue: changed WebView to allow scrolling/nested scrolling and changed Leaflet touch-action to `pan-x pan-y`.
- Vehicle tab:
  - Added vehicle registration.
  - Reworked from all-vehicle scrolling cards to one dropdown-selected vehicle detail.
  - Added fleet-wide maintenance due alerts.
- Trip tab:
  - Removed driver-mode metrics.
  - Added operator rank input.
  - Split inputs into operator, route, and odometer sections.
  - Blank start odometer now uses selected vehicle's saved current km.
  - End odometer on trip completion updates vehicle current km for maintenance/vehicle tab.
- Records tab:
  - Displays latest OBD fuel percentage when available.
  - True fuel consumption still needs tank capacity or start/end fuel readings to calculate accurately.
- Verification passed with `npm.cmd run verify`.

# 2026-07-14 handoff: map and driver-mode refinement

- Added after commit `b71d20f`.
- Driver mode tab bar should show only `운행`. Commander mode keeps the management tabs.
- Location map zone setup was improved:
  - `지도에서 위치 선택` enables selection mode.
  - The map displays a center crosshair and a `중심 좌표 사용` button.
  - Users can still tap the map directly to fill latitude/longitude.
- Shared card styling now uses subtle shadows for a more polished UI.
- OBD behavior:
  - If a BLE OBD device was saved from the vehicle/diagnosis flow, 운행 start attempts automatic connection.
  - The 운행 screen now displays the saved OBD device and whether it will auto-connect.
- Verification passed with `npm.cmd run verify`.

# 2026-07-14 handoff: simplified UI direction

- Current branch for this pass: `claude/env-permissions-session-restart-154onb`.
- User feedback: UI/UX felt too complex and old-fashioned. Keep screens simple, readable, and avoid decorative/tacky emoji.
- User clarified that `기록` and `월장비운행증` are the same workflow. Do not keep them as two competing tabs.
- Implemented:
  - `monthly-log` is hidden from the bottom tab bar.
  - Bottom tabs now use simple monochrome symbols: `▶`, `≡`, `▣`, `⌖`, `✓`.
  - Added `components/vehicle-dropdown.tsx` for shared vehicle selection.
  - 운행 and 기록 screens now use the shared dropdown instead of wrapping vehicle pill buttons.
  - Touched screen copy was restored to clean Korean.
  - `npm.cmd run verify` passed.
- Next recommended work:
  - Apply the same `VehicleDropdown` pattern anywhere else that asks for a vehicle selection.
  - Keep the tab count small; prefer improving the existing 기록 screen over reintroducing 월장비운행증 as a separate tab.
  - Device-test APK after GitHub Actions finishes, especially tab navigation and trip start/end.
