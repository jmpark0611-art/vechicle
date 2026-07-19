# 변경 이력

## 2026-07-19 driver UI runtime cleanup

- Pulled UI/UX commit `433a2e4` with the dark split driver trip layout.
- `npm.cmd run verify` passed after the pull.
- Removed the old unreachable active-trip and completion render branches that remained below the new early-return screens.
- Removed the dead styles tied to those unreachable branches so future driver UI changes do not drift between two competing layouts.
- Fixed trip cancel writes to use schema-valid `canceled` instead of `cancelled`.
- Verification passed with `npm.cmd run verify`.

## 2026-07-19 trip delete policy no-op detection

- Checked the live Supabase `trips` table with the app anon key during field-test cleanup.
- 29 trip records were visible, but an anon delete attempt removed 0 rows and the count stayed at 29.
- Root cause: live Supabase still needs the `trips_anon_delete` RLS policy from `docs/schema.sql` before app-side trip cleanup can actually delete records.
- `deleteTripsByIds()` now verifies the rows after deletion and throws a clear policy/migration error if Supabase silently blocks the delete.
- Actual cleanup of existing test trip records still requires applying the Supabase delete policy or using service-role/admin access.

## 2026-07-19 records refresh overlap fix

- Moved the records refresh action from the bottom primary button to a compact top-right button.
- This prevents the refresh button from visually overlapping the last record card and bottom tab bar on narrow Android screens.
- Verification passed with `npm.cmd run verify`.

## 2026-07-19 unused feature cleanup

- Removed the hidden legacy `monthly-log` tab because 월장비운행증 now lives in the records tab export/detail flow.
- Removed unused legacy helpers: `lib/speed-zones.ts`, `lib/driver-info.ts`, obsolete commander PIN setter/clearer functions, and unused role session-verification helpers.
- Removed the old `fetchMonthlyTrips()` data path that was only used by the deleted monthly-log screen.
- Removed unused `RebuildScreen` props and stale mode-settings style.
- Verification passed with `npm.cmd run verify`.

## 2026-07-19 role guard cleanup

- Added a shared `useRoleGuard()` hook for tab-level role protection.
- Driver-only, commander-only, and admin-only tabs now redirect stale cached/direct routes back to the correct mode home screen.
- Source checks now require the new `admin-pin.tsx` screen and the `alerts.tsx` maintenance tab so future accidental deletions are caught.
- Verification passed cleanly with `npm.cmd run verify`.

## 2026-07-19 admin speed mode and overspeed stage 3

- Added a separate administrator mode for speed-zone/map management.
- Administrator PIN is temporarily fixed as `1862`.
- Commander mode no longer shows the speed tab; speed-zone setup now belongs to administrator mode.
- Administrator mode opens the speed tab directly and only exposes that tab.
- Overspeed warning de-dupe no longer changes on every small speed change, preventing repeated voice/popup spam while staying in the same zone.
- Overspeed warning state resets once no overspeed alert is present, so re-entering an overspeed state can warn again.
- Verification passed with `npm.cmd run verify`.

## 2026-07-19 overspeed voice warning stage 2

- Added `expo-speech` and wired foreground voice guidance into the shared overspeed warning service.
- Overspeed now attempts to speak `제한속도 초과입니다. 감속하세요.` before vibration and popup.
- Speech failures are caught so vibration/popup still run if the device cannot speak.
- Refactored driver trip and commander speed tab to call the same shared warning function.
- Records tab can now delete the currently visible trip records after a destructive confirmation popup.
- Verification passed with `npm.cmd run verify`.

## 2026-07-19 overspeed warning shared foundation

- Pulled the latest UI/UX work through `1b870fd`.
- Added `lib/overspeed-warning.ts` as the shared foreground overspeed warning foundation.
- Driver trip screen and commander speed tab now share the same overspeed vibration pattern and de-dupe key.
- Kept this stage free of new native audio/background dependencies to avoid repeating the APK app-open crash regression.
- Verification passed with `npm.cmd run verify`.

## 2026-07-19 driver overspeed warning

- Overspeed warning is no longer limited to the speed/map tab.
- Driver trip screen now checks speed-zone alerts after GPS point saves while a trip is active.
- GPS point saves can now receive an OBD speed override so zones still evaluate when Android GPS speed is missing.
- Foreground warning uses phone vibration plus an alert popup with vehicle, zone, current speed, and speed limit.
- Driver-mode speed-zone checks now run every 10 seconds instead of waiting for the old 60-second GPS save interval.
- Trip-start now waits for the first overspeed check after the initial GPS point save, so entering a configured zone immediately after start is not silently missed.

## 2026-07-19 active trip live dashboard

- Active driver trip screen now shows phone-readable live information when the app is opened mid-drive.
- Added current time, elapsed trip time, and accumulated GPS movement distance to the running trip card.
- GPS movement distance refreshes every 15 seconds while a trip is active.
- The duplicate active-trip render path was kept in sync so future route/layout changes do not drift.

## 2026-07-19 faster driver OBD auto-connect

- Driver input screen now attempts OBD connection before pressing trip start when a saved BLE device exists.
- While the driver input screen is open, the app retries connection every 6 seconds until connected.
- If a saved BLE device ID is stale, connection now falls back to a short BLE rescan and reconnect attempt instead of staying at `자동연결 준비`.
- Reduced default BLE scan window from 3 seconds to 2 seconds for faster in-vehicle recognition.

## 2026-07-18 vehicle unit FK fallback

- Vehicle registration no longer blocks field testing when `vehicles.unit_code` references a unit code that has not been seeded in Supabase yet.
- If insert with the selected `unit_code` fails on `vehicles_unit_code_fkey`, the app retries the same vehicle number with `unit_code: null`.
- This keeps vehicle registration and `1862-Test` auto-registration working until the full Supabase unit seed/migration is applied.

## 2026-07-18 1862-Test device-to-vehicle matching

- Known BLE adapter `7E:57:58:E1:03:3D` still displays as `1862-Test`.
- Driver and diagnosis flows now treat that alias as the vehicle number too.
- When the saved/scanned adapter is `1862-Test`, the app selects the registered `1862-Test` vehicle; if it does not exist, it attempts to create it and select it.
- Duplicate/create fallback reloads the vehicle list and selects the existing `1862-Test` vehicle when present.

## 2026-07-18 OBD BLE stale-device reconnect

- Diagnosis `단말기 연결` no longer shows raw BLE disconnect errors such as `Device ... was disconnected` as the primary status.
- If a previously saved OBD BLE device fails to connect, the app now disconnects, scans again, remembers the best OBD/VLink candidate, and retries connection once automatically.
- Final failure messages are normalized into Korean guidance so testers know to check Android-VLink power/Bluetooth state and retry.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 trip start legacy schema fallback

- Fixed trip start failure on Supabase databases that have not yet applied `trips.unit_code`.
- `startManualTrip()` now retries without `unit_code` using legacy trip select columns, instead of reselecting the missing column during fallback.
- The app still keeps the unit-aware schema path for later Supabase migration; this change only prevents field testing from being blocked before migration.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 duplicate vehicle registration handling

- Vehicle registration no longer surfaces raw Supabase duplicate-key errors for `vehicles_vehicle_number_key`.
- When the entered vehicle number already exists, the app now returns and selects the existing vehicle instead of failing the registration flow.
- Diagnosis registration success copy now says `차량 등록/선택 완료`.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 speed zone legacy schema fallback

- Speed-zone save no longer blocks field testing when Supabase has not yet applied `speed_zones.unit_code`, `zone_kind`, or `polygon_points`.
- If polygon/unit columns are missing, the app now saves the zone using the legacy center/radius columns.
- Polygon zones are temporarily approximated as center-radius zones until the full `docs/schema.sql` migration is applied.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 duplicate vehicle registration block

- Changed duplicate vehicle registration behavior from selecting the existing vehicle to blocking the registration.
- Duplicate vehicle numbers now show a `중복 차량번호` popup with guidance to use the existing vehicle from the dropdown.
- Raw Supabase unique constraint messages remain hidden from the operator.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 faster OBD BLE recognition

- Reduced BLE OBD scan timeout from 8 seconds to 3 seconds.
- BLE scans now stop early when a strong OBD/VLink/ELM candidate is found.
- `이름 없는 BLE 장치` is saved and displayed with the current vehicle number, such as `222 OBD 단말기`, in driver and diagnosis flows.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 1862-Test OBD device alias

- Added a local BLE device alias for `7E:57:58:E1:03:3D` as `1862-Test`.
- Scan results, saved device loading, and saved device writing now normalize that BLE ID to the `1862-Test` display name.
- This keeps the known test adapter from appearing as `이름 없는 BLE 장치`.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 role selection polish and fleet alert tab

- Renamed the commander `알림` tab to `정비` because it now combines fleet alerts with vehicle-specific maintenance settings.
- Moved periodic replacement item cards out of the diagnosis tab and into the `정비` tab under a new `차량 설정` section with vehicle dropdown, current km baseline, ECU receive status, and replacement completion buttons.
- Diagnosis screen moved `차량 등록` from a wide full-width button to a compact top-right pill and made `ECU 감지 정보` / `주기성 교환품목` section titles larger with distinct accent colors.
- Mode selection first screen now uses the softer title `차량 운행관리`, larger mode cards, and more spacing between the title and mode guidance text.
- Added a commander-only `알림` tab that gathers all vehicles needing periodic replacement or ECU-based inspection.
- The new alert tab flags maintenance items within 1,000km/overdue and ECU values outside first-pass thresholds: DTC, coolant temperature, battery voltage, fuel level, engine load, fuel trims, and emissions readiness.
- `교체완료` updates the replacement baseline, while `점검완료` acknowledges the current ECU value and shows the alert again if a different value is received later.
- Commander diagnosis mode now also shows an automatic phone alert when newly received OBD live data crosses an ECU threshold; driver trip mode does not show these maintenance popups.
- Driver trip mode now quietly writes latest OBD live data into the shared local OBD snapshot, so commander `알림` can surface detected issues later without interrupting the driver.

## 2026-07-17 VIN and emissions readiness OBD support

- Extended OBD live data with inspection-oriented fields: VIN, readiness summary, DTC count, intake temperature, throttle, engine load, fuel trims, MAP pressure, and oxygen sensor voltage.
- Native BLE OBD polling now requests additional ELM327 PIDs including `0101`, `0104`, `0106`, `0107`, `010B`, `010F`, `0111`, `0114`, and `0902`.
- Diagnosis cards now show received values for these fields instead of fixed placeholders when the vehicle/adapter supports them.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 expanded diagnosis and maintenance cards

- Removed the duplicated square `ECU 상태` card because the horizontal `ECU 감지 상태` bar already shows that information.
- Diagnosis ECU cards now include RPM, OBD speed, coolant, battery, fuel, DTC count, and placeholder cards for supported future PIDs such as intake temperature, throttle, engine load, fuel trim, MAP, oxygen sensor, VIN, and readiness monitors.
- Periodic maintenance items now include fuel filter, coolant, brake oil, transmission oil, power steering oil, battery, tire, brake pad, wiper blade, spark plug, and timing belt in addition to the original oil/filter items.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 active trip odometer wording

- Active trip card now labels the departure odometer as `계기판 누적거리`.
- When the active trip row has no start odometer, the card falls back to the selected vehicle's current odometer baseline.
- The destination odometer auto-calculation hint uses the same baseline value.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 diagnosis ECU bar and trip completion isolation

- Diagnosis selected-vehicle detail now replaces the old vehicle/current-km strip with a horizontal `ECU 감지 상태` card.
- Trip OBD fuel baseline is now captured from the first live fuel reading if OBD connects after trip start.
- Active trip screen now shows current fuel and consumed fuel percentage.
- After trip completion, the start form is no longer rendered below the completion summary; users must tap `새 운행 입력` to begin another entry.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 speed tab live overspeed alert

- Renamed the commander `위치` tab and screen title to `속도`.
- Speed tab now refreshes the location snapshot every 10 seconds while open, so saved speed zones can raise overspeed warnings without manual refresh.
- Overspeed warnings now use a stronger vibration pattern plus the Android system alert dialog. A forced custom warning sound still requires adding and validating a native audio/notification module.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 stronger diagnosis compact layout

- Diagnosis detail no longer uses an empty `SectionCard` title area; it now renders as a custom compact panel.
- Vehicle/current-km info is shown as the first horizontal bar inside the panel.
- ECU cards are reduced to 96px minimum height, and maintenance cards use a separate shorter layout.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 compact diagnosis cards

- Diagnosis detail header now uses one horizontal bar for vehicle number and current km instead of a separate rounded title/current block.
- ECU and maintenance cards are shorter rectangular cards instead of tall square cards.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 automatic OBD retry on trip screen

- Trip screen OBD status now shows real automatic connection states instead of a static `대기` label.
- When a trip is active, the app now automatically connects to the saved OBD device.
- If no saved OBD device exists, the trip screen automatically scans for an OBD candidate, saves the first candidate, and connects.
- If connection fails or disconnects during a trip, the app retries automatically every 12 seconds.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 trip completion auto summary

- Active trip screen no longer asks for manual end odometer input.
- Trip completion now saves a final GPS point, calculates actual GPS movement distance, and estimates end odometer from start odometer plus GPS distance when a direct OBD odometer value is unavailable.
- After trip completion, the trip tab shows `안전운행해주셔서 감사합니다` with the monthly equipment operation log fields: vehicle, route, times, odometer total/trip distance, GPS distance, fuel used, purpose, operator, and user.
- Fuel used is shown as OBD fuel percentage difference when start/end OBD fuel data exists.
- Full-screen speed-zone map modal now respects the device safe area to avoid status-bar/header overlap.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 tab title only and compact trip form

- Removed the top-right role/mode switching pill from all tabs.
- Common screen header now shows only the current tab name in a larger blue title instead of `차량운행시스템`.
- Trip tab removed duplicate odometer/OBD summary cards and compressed card/input spacing so the start form sits higher and fits better on one screen.
- Vehicle dropdown supports a compact height for dense screens.
- Diagnosis tab removed the manual current-km input/save block and now shows current km as a small read-only pill.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 stable APK download link

- Android APK workflow now updates a fixed `latest-apk` GitHub Release so the APK download URL stays stable across builds.
- Web deploy workflow now publishes `/download.html`, a visible GitHub Pages download page with a large APK download button.
- Stable direct APK URL: `https://github.com/jmpark0611-art/vechicle/releases/download/latest-apk/app-release.apk`.
- Stable visible page: `https://jmpark0611-art.github.io/vechicle/download.html`.

## 2026-07-17 trip home redesign and fuel usage detail

- Reworked the common top header into a cleaner brand-style header (`차량운행시스템`) with the active tab shown as a smaller secondary line.
- The right-side role button now changes modes directly: driver opens commander PIN, commander switches back to driver mode.
- Trip tab was redesigned into a dark hero card, summary cards, grouped input cards, and an in-screen start/end action button instead of a single dense form card.
- Records detail and monthly export now include `소모한 유류`, calculated from the first and last OBD fuel percentage saved for each trip.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 tab header and speed-zone form polish

- Common tab headers now use a compact pill with a small icon mark instead of a plain text title.
- The role pill opens mode settings directly, and the separate gear/radar-looking button was removed.
- Commander PIN success now routes directly to the records tab, and the trip screen redirects commanders away if a cached route tries to open it.
- Trip primary button no longer pushes itself to the bottom of the screen, reducing the large blank area on the trip tab.
- Location speed-zone form now places zone name and speed limit on one row, renames the map button to `구역 설정`, removes undo buttons, and remounts the large map on reset so cleared vertices disappear reliably.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 speed-zone integer save fix

- Polygon speed-zone save now rounds computed radius meters and speed-limit values before inserting into Supabase.
- This fixes production DBs where `speed_zones.radius_m` or `speed_limit_kmh` are integer columns and rejected decimal values like `470.8712088862511`.
- Verification passed with `npm.cmd run verify`.

## 2026-07-17 visible mode UI and trip spacing refresh

- Mode selection screen now uses visual emoji icons instead of Korean letters inside the icon blocks.
- Mode selection cards were restyled with softer pastel cards, cleaner copy, and a more polished hero area.
- Rebuild screen content now uses `flexGrow` and pushes the primary action button toward the bottom of the available screen instead of leaving loose blank space.
- Trip input spacing and field heights were tightened so the trip screen fills the viewport more naturally.
- Common tab title text was reduced further to avoid the oversized, plain-title look.
- Verification passed with `npm.cmd run verify`.

## 2026-07-16 strict role tabs and fixed commander PIN

- Driver mode now shows only the trip tab.
- Commander mode now hides the trip tab and shows records, diagnosis, location, and check tabs.
- Commander mode still requires PIN entry before entering the app.
- Commander PIN is fixed to `1862`; previous locally stored PIN values are ignored.
- PIN change controls were removed from settings/check screens to avoid conflicting with the fixed PIN policy.
- Verification passed with `npm.cmd run verify`.

## 2026-07-16 launch mode and compact header

- Root layout now relies on the Stack initial route so the mode-selection screen is the first screen without startup-time forced navigation.
- Added an explicit `app/index.tsx` redirect to `/role-select` so APK startup lands on mode selection reliably.
- Common tab headers were reduced to a cleaner line-style header with smaller title text.
- Moved the primary action button into the scroll content instead of a fixed footer to remove the large blank gap above the tab bar.
- Verification passed with `npm.cmd run verify`.

## 2026-07-16 odometer and actual trip distance

- Records detail popup now separates odometer total distance, odometer trip distance, and actual GPS movement distance.
- Monthly equipment operation log rows were reshaped as daily/operation entries based on trip-screen data.
- Monthly log now includes route content, operator/user rank+name, odometer total, odometer trip distance, and GPS actual distance.
- Added GPS distance calculation from saved `gps_points` without requiring a new Supabase migration.
- Verification passed with `npm.cmd run verify`.

## 2026-07-16 trip header and launch stability

- Reworked the common screen header into a softer pastel card so tab titles no longer appear as plain oversized text.
- Reduced the common bottom padding to cut the empty space above the tab bar.
- Reverted the native `expo-notifications` experiment after the APK showed a launch crash on device.
- Reverted startup-time forced role navigation; mode changes remain available from the app flow without risking root-layout navigation crashes.
- Trip completion/cancel now clears transient input fields so the next trip starts from blank inputs.
- Verification passed with `npm.cmd run verify`.

## 2026-07-15 commander diagnosis flow

- Diagnosis tab now places a `단말기 연결` button next to vehicle selection for commander-mode spot checks.
- Diagnosis data is separated into ECU detected values and periodic replacement items, each rendered as two-column square cards.
- OBD fuel storage was aligned with the Supabase `fuel_level_percent` column.
- Records tab now shows only date and route in the list; tapping a record opens the monthly-log detail data in a popup.
- Monthly operation log export now includes rank/name fields, latest OBD fuel, and inferred refuel events when fuel percentage rises sharply.
- Trip tab now stores operator/user rank fields and auto-fills the start odometer from the selected vehicle's synced current km.
- The shared screen header was reduced and softened so the top title looks less oversized.
- Verification passed with `npm.cmd run verify`.

## 2026-07-15 UX cleanup batch

- Location tab removed new circle-zone setup and now saves polygon zones from the full-screen map footer.
- Location tab removed the visible speed-alert and active-vehicle list sections; registered speed zones remain visible.
- Overspeed inside a configured speed zone now triggers a vibration plus alert while the app is open.
- Vehicle tab registration now opens a modal for vehicle number, type, and initial odometer; the inline registration input was removed.
- Records tab adds a monthly equipment operation log export through the native share sheet.
- Vehicle dropdown copy was simplified by removing the extra label text.
- Trip tab compacted driver/user inputs into rank/name rows and added a same-as-driver toggle for the user fields.
- Verification passed with `npm.cmd run verify`.

## 2026-07-15 pastel diagnosis UI

- Renamed the vehicle tab UI label to `진단`.
- Reworked the diagnosis screen into a two-column square-card grid instead of long vertical maintenance cards.
- ECU/OBD readings and periodic maintenance items now appear together in the grid.
- Maintenance cards retain the replacement-complete action.
- Updated the common screen shell and tab bar to a softer pastel palette.
- Verification passed with `npm.cmd run verify`.

## 2026-07-15 polygon speed zones

- Location tab speed-zone registration now supports two modes: polygon area zones and legacy circular zones.
- Polygon mode lets the user tap the Leaflet/OpenStreetMap map to add 3+ vertices, undo the last point, clear the draft, preview the area, and save it.
- Existing circle zones remain supported with center coordinate and radius.
- Speed-zone alert calculation now checks whether a vehicle GPS point is inside a polygon area before applying the speed limit.
- `docs/schema.sql` adds `speed_zones.zone_kind` and `speed_zones.polygon_points` for Supabase migration.
- `lib/location-data.ts` falls back to the old speed_zones select when the DB has not yet received polygon columns, so the screen does not crash on older schemas.
- Verification passed with `npm.cmd run verify`.

## 2026-07-15 large map zone picker

- Speed-zone editing now opens a full-screen map modal for easier area selection on mobile.
- The small location map is preview-only; polygon/circle selection is done in the large map.
- Polygon points are now drawn inside the Leaflet WebView without reloading the map on every tap, reducing unexpected zoom/position jumps.
- Leaflet double-click zoom is disabled while selecting zones to avoid accidental zoom changes during point placement.
- Save error wording now distinguishes missing polygon DB columns from a missing `speed_zones` table.
- Verification passed with `npm.cmd run verify`.

## 2026-07-14 OBD manual diagnostic records

- Continued on branch `rebuild/clean-sdk54-start` after the known-good APK release `apk-29255828399`.
- Added `lib/obd-data.ts` for OBD readings stored locally first with optional Supabase sync.
- Vehicle tab now has an `OBD 수동 진단` panel per vehicle for RPM, speed, coolant temperature, battery voltage, fuel percentage, and DTC count.
- Added `obd_logs` table, indexes, trigger, and anon select/insert RLS policies to `docs/schema.sql`.
- Check tab now reports the `obd_logs` table status.
- This step intentionally adds no BLE/native scanner package. Real OBD Bluetooth connection should be a separate APK-tested step after this UI/data path is stable.

## 2026-07-14 Speed-zone alert preview

- Added distance-based speed-zone alert calculation to `lib/location-data.ts`.
- Location tab now shows vehicles detected inside registered speed zones.
- If a GPS point includes speed and it is higher than the zone limit, the card marks it as `초과 의심`.
- This step adds no new native module or permission; it only computes alerts from existing `gps_points` and `speed_zones` data.
- Verification passed with `npm.cmd run verify` and Android export.

## 2026-07-14 Experimental OBD BLE scanner search

- Created branch `feature/obd-ble-elm327-probe` from the confirmed stable rebuild branch.
- Added `react-native-ble-plx` and Expo config plugin settings for Android Bluetooth scan/connect permissions.
- Added `lib/obd-ble.ts` and `lib/obd-ble.native.ts` with the same exported scan/selection API so Android bundling resolves correctly.
- Vehicle tab now includes an `OBD BLE 스캐너` panel that scans only after the user presses the search button.
- The scan step saves a selected BLE OBD candidate locally, but does not yet send ELM327 AT commands.
- Important: many low-cost ELM327 adapters are Classic Bluetooth, not BLE. Those may pair in Android settings but not appear in BLE scanning.
- Verification passed with `npm.cmd run verify`, `npx.cmd expo export --platform android`, `npx.cmd expo-doctor`, and `npx.cmd expo prebuild --platform android --no-install --clean`.
- GitHub Actions APK build succeeded for run `29292928878`.
- Experimental APK: `https://github.com/jmpark0611-art/vechicle/releases/download/apk-29292928878/app-release.apk`
- Stable non-BLE APK before this experiment: `https://github.com/jmpark0611-art/vechicle/releases/download/apk-29286648719/app-release.apk`

## 2026-07-13 정비 교체완료 기능

- User confirmed the previous APK `apk-29252766820` as "작동 이상무".
- Added vehicle maintenance replacement completion on the rebuilt stable branch.
- Vehicle tab now supports local current odometer entry and replacement-completion buttons for engine oil, oil filter, and air filter.
- Pressing "교체완료" records the current km locally and recalculates the remaining km until the next replacement cycle.
- This step adds no GPS, WebView map, OBD/BLE, Reanimated, new Android permissions, or Supabase schema writes.

## 2026-07-13 정비 Supabase 동기화 및 APK workflow 보정

- Investigated the failed APK workflow run after `d42377c`; it failed in `Setup Android SDK` before app code was built.
- Replaced the external Android SDK setup action with a runner SDK check/license step.
- Added `maintenance_records` to `docs/schema.sql`.
- Maintenance completion now attempts Supabase insert and safely falls back to local AsyncStorage when the DB table is not ready.
- Vehicle tab shows the maintenance sync status.
- Verification passed with `npm run verify` and Android export.

## 2026-07-13 읽기 전용 위치판

- Added a read-only location data layer for active trips, latest GPS points, and speed zones.
- Replaced the location tab placeholder with a simple marker board, active vehicle list, and speed-zone list.
- Added `speed_zones` table schema, indexes, triggers, and RLS policies to `docs/schema.sql`.
- This step adds no GPS permission, WebView map, OBD/BLE, Reanimated, or new native startup module.
- Verification passed with `npm run verify` and Android export.

## 2026-07-13 제한속도 구역 등록

- Added speed-zone creation from the location tab.
- Users can enter zone name, latitude, longitude, radius, and speed limit.
- The app validates coordinates/radius/speed before saving to Supabase.
- Missing `speed_zones` DB table is handled with an Alert instead of a crash.
- Verification passed with `npm run verify` and Android export.

## 2026-07-13 GPS 1회 저장 복구

- Reintroduced `expo-location` for foreground GPS only.
- Added Android foreground location permissions.
- Trip start and trip completion now attempt to save one current GPS point to `gps_points`.
- GPS permission denial, missing DB table, RLS failure, and timeout paths are reported through messages without blocking the trip flow.
- Verification passed with `npm run verify`, `npx expo-doctor` 18/18, and Android export.

## 2026-07-13 Supabase RLS 스키마 보강

- Added RLS enablement and anon policies for vehicles, trips, and gps_points in `docs/schema.sql`.
- The schema now covers the rebuilt app's current write paths: trip start, trip completion, GPS point insert, maintenance record insert, and speed-zone insert.

## 2026-07-13 시스템 점검 화면 보강

- Rebuilt the check tab as a clean Korean diagnostics screen.
- The screen now checks vehicles/trips plus gps_points, maintenance_records, and speed_zones.
- Missing table and query failures are shown per table to make device testing easier.
- Verification passed with `npm run verify` and Android export.

## 2026-07-07 수송부 PIN 재인증 루프 차단

- 수송부 PIN 성공 후 기록 화면이 잠깐 보였다가 사라지는 문제를 수정했다.
- 원인은 루트 레이아웃이 저장된 역할이 `commander`이면 항상 `/commander-pin`으로 다시 보내는 재인증 로직이었다.
- PIN 성공 시 `markCommanderPinVerified()`로 현재 세션 인증 상태를 저장하고, 루트 레이아웃은 인증 세션이 없을 때만 PIN 화면으로 이동하도록 변경했다.
- 웹에서는 `sessionStorage`를 사용해 같은 브라우저 탭 안에서 방금 인증한 상태를 유지한다.
- `npm.cmd run verify` 통과. 기존 미사용 변수 경고는 유지된다.

## 2026-07-07 수송부 탭 초기 렌더링 흰 화면 방지

- 역할 확인 전에는 Tabs를 렌더링하지 않고 로딩 화면을 표시하도록 변경했다.
- 이전 구조는 `ready=false` 상태에서도 모든 탭의 `href`가 `null`로 계산되어 웹에서 수송부 모드 진입 시 빈 화면이 고착될 수 있었다.
- 역할 확인 후 수송부 모드는 `explore`, 운행 모드는 `index`를 초기 탭으로 지정했다.
- `npm.cmd run verify` 통과. 기존 미사용 변수 경고는 유지된다.

## 2026-07-07 수송부 PIN 후 탭 권한 재조회 수정

- 탭 레이아웃이 최초 렌더링 때만 저장된 역할을 읽던 문제를 수정했다.
- PIN 성공 후 `commander` 역할이 저장되어도 이미 마운트된 탭 레이아웃의 role 상태가 갱신되지 않아 수송부 탭이 계속 숨겨지고 흰 화면처럼 보일 수 있었다.
- `useFocusEffect`로 탭 화면이 포커스될 때마다 `getStoredRole()`을 다시 읽도록 변경했다.
- `npm.cmd run verify` 통과. 기존 미사용 변수 경고는 유지된다.

## 2026-07-07 수송부 PIN 웹 이동 경로 재수정

- 수송부 PIN 성공 후 이동 경로를 `/(tabs)/explore`에서 실제 웹 라우트 `/explore`로 변경했다.
- GitHub Pages 정적 배포에서는 탭 그룹 세그먼트 `/(tabs)`가 URL 경로로 동작하지 않을 수 있어 흰 화면/이동 실패가 반복될 수 있었다.
- `npm.cmd run verify` 통과. 기존 미사용 변수 경고는 유지된다.

## 2026-07-07 수송부 PIN 흰 화면 수정

- 수송부 PIN 인증 성공 후 `/(tabs)`로 이동하던 경로를 `/(tabs)/explore`로 변경했다.
- 수송부 모드에서는 운행 `index` 탭이 숨겨지므로 기본 탭으로 진입하면 흰 화면이 나올 수 있었다.
- `npm.cmd run verify` 통과. 기존 운행 탭 미사용 변수 경고 5건은 유지된다.

## 2026-07-07 APK 다운로드 상태 갱신

- 최신 release APK GitHub Actions run `28795041514`가 성공 완료됐다.
- 생성된 artifact는 `vehicle-system-release-apk`이며 artifact ID는 `8110995186`이다.
- 사용자가 기존 debug APK를 설치했을 때 스플래시 화면에 멈췄으므로, 이후 테스트는 반드시 release APK로 진행해야 한다.
- 다운로드 기준 페이지는 `https://github.com/jmpark0611-art/vechicle/actions/runs/28795041514`이다.
- 모바일에서 Artifacts가 보이지 않으면 데스크톱 사이트 모드 또는 artifact 직접 경로 `https://github.com/jmpark0611-art/vechicle/actions/runs/28795041514/artifacts/8110995186`를 사용한다.

## 2026-07-06 APK 배포 정리

- EAS Android 빌드는 Expo 무료 플랜 월간 Android 빌드 한도 초과로 실패했다.
- GitHub Actions에서 EAS 대신 Gradle로 APK를 직접 만드는 워크플로를 추가했다.
- 최초 debug APK artifact(`vehicle-system-debug-apk`)는 생성됐지만 실기기에서 스플래시 화면에 멈췄다. 단독 테스트용으로 부적합하다고 판단했다.
- 워크플로를 `assembleRelease` 기반으로 변경해 JS 번들이 포함된 release APK artifact(`vehicle-system-release-apk`)를 만들도록 수정했다.
- 최신 release APK run은 `28794479728`이며, 다음 작업자는 완료 후 artifact 다운로드 링크를 확인해야 한다.

## 최신 작업

- 차량 진단 화면을 `Vehicle system UI improvement.zip`의 333 화면 흐름에 맞춰 라이트/딥네이비 계열 구조로 정리했다.
- 차량 선택 칩, OBD 스캐너 상태 카드, ECU 실시간 데이터 2열 카드, DTC 상태, 차량 정보 패널, 소모품 교환주기 영역을 한 화면 흐름으로 재배치했다.
- 데모에 보이지 않던 기존 기능을 제거하지 않고 차량 요약, 검색, 상태 필터, 차량 드롭다운, OBD 연결, 번호 수정, 삭제, 운행 상세 이동, 교체완료 버튼을 유지했다.
- `npm.cmd run verify` 통과. 남은 경고는 운행 탭의 기존 미사용 음성/OBD 상태 코드 5건이다.

## 현재 작업본

- `Vehicle system UI improvement.zip` 기준의 라이트/딥네이비 하이파이 디자인을 현재 작업 기준으로 확정했다. 과거 다크+라임 UI는 더 이상 기준으로 사용하지 않는다.
- 역할 선택 화면을 중앙 로고, 큰 모드 카드, 테마 선택 점 UI가 있는 라이트 디자인으로 정리했다.
- 운행 시작 화면을 시안 순서에 맞춰 `차량 선택` → `운행 정보` → `경로` 카드 구조로 재배치했다.
- 운행 시작 전 OBD 진단 카드는 운행탭에서 제거하고 차량 진단/OBD 화면 역할로 분리했다.
- `source-check`의 필수 문구를 현재 데모 UI 기준으로 조정했다.
- 차량 화면의 `/obd` 이동을 typed route 오류 없이 동작하도록 보강했다.
- `docs/demo-parity.md`를 추가해 데모 HTML과 APK의 화면/기능 동등성 체크리스트를 명문화했다.
- 기록 화면 상단을 데모 기준의 `운행 기록` 헤더, CSV 버튼, 카드형/리스트형 토글, 전체/운행중/완료 필터 구조로 정리하고 카드형 기록에 주행거리/누적거리/유류사용 3지표 타일을 추가했다.
- 앱 이름을 `차량운행시스템`으로 정리했다.
- 한글 깨짐을 고치고 `source-check`로 재발을 검사한다.
- `/status` 충돌을 피하기 위해 점검 화면은 `/check`를 사용한다.
- 운행 화면에 차량 선택, 출발지/목적지 입력, 웹 음성 입력, 위치 권한 상태, GPS 저장 상태, 진행 중 운행 복구를 넣었다.
- GPS 저장에는 타임아웃, 재시도, 실패 횟수 표시를 적용했다.
- 기록 화면에 상태/기간/차량/검색 필터, CSV 내보내기, GPS 누락 경고를 넣었다.
- 기록 화면에 `운행 기록 더 보기` 버튼을 추가해 최근 30건 이후의 운행도 30건 단위로 이어서 불러오도록 했다.
- 차량 화면에 등록/수정/삭제, 중복 검사, 상태/검색 필터, 요약 통계를 넣었다.
- 차량 삭제 직전에 Supabase에서 해당 차량의 전체 운행 기록 수를 다시 확인해 오래된 기록이 있는 차량 삭제를 막도록 보강했다.
- 차량 화면의 전체/완료/미종료 운행 수를 차량별 Supabase exact count 기준으로 보강했다.
- 운행 상세 화면에 추정 거리, 평균/최고 속도, GPS 수집 구간, GPS 품질 안내, 지도 열기를 넣었다.
- 점검 화면에 앱/SDK 버전, Supabase 설정 출처, GPS 경과, 중복/장시간 운행 경고를 넣었다.
- 점검 화면의 진행 중 운행 목록에 전체 대비 현재 표시 수 안내를 추가했다.
- 주요 ScrollView 화면에 안전영역 기반 상하단 여백을 적용해 Android/iPhone에서 화면 잘림을 줄였다.
- 주요 툴바/카드 헤더/정보 행/액션 행에 줄바꿈 여유를 추가해 작은 모바일 화면에서 텍스트와 버튼 쏠림을 줄였다.
- 긴 차량번호, 장소, 요약 값에 자동 글자 크기 조정과 한 줄 제한을 적용해 모바일 화면 넘침을 줄였다.
- 기록/차량 필터 바가 작은 모바일 화면에서 2열로 자연스럽게 감기도록 보강했다.
- Expo 템플릿 리셋 스크립트와 미사용 템플릿 컴포넌트를 제거했다.
- 주요 액션 버튼에 접근성 라벨을 붙였다.
- 차량 화면에 같은 차량의 중복 미종료 운행 요약과 차량별 경고를 추가했다.
- `npm.cmd run verify`와 `npm.cmd run health`를 기준 검증 명령으로 정리했다.
## 2026-07-13 Clean rebuild stage 1

- Created branch `rebuild/clean-sdk54-start` for a clean Expo SDK 54 rebuild after repeated installed APK startup crashes.
- Replaced the app with a minimal, launch-first route structure:
  - role select
  - commander PIN
  - tabs for trip, records, vehicles, map, check
- Kept UI direction visible with light/navy cards and readable Korean labels, but intentionally stubbed database, GPS, WebView map, and OBD/BLE functionality.
- Removed direct native startup risk modules from this rebuild branch: Reanimated, Worklets, BLE PLX, WebView, Location, Haptics, Expo Image, Expo Symbols, and Expo Web Browser.
- Simplified `app.json` to no runtime permissions and `newArchEnabled: false`.
- Replaced legacy source-check rules with clean rebuild checks.
- Verification passed: `npm run verify`, `npx expo-doctor`, and Android export.
- Built APK #96 and confirmed from user device screenshot/report that the app opens successfully.
- Marked build #96 as the known-good launch baseline. Future work should add features one small APK-testable step at a time.

## Deferred cleanup note

- Do not delete old project files during the early rebuild just because the clean baseline does not currently use them.
- Existing code and history remain the reference for restoring behavior and UI.
- Cleanup will be done later after the rebuilt app is stable and feature parity is verified.

## 2026-07-13 Clean rebuild step 1: Supabase read-only data

- Added a read-only Supabase data module for the rebuild branch.
- Connected `vehicles` and `trips` reads without adding writes, GPS, WebView, OBD/BLE, or new native permissions.
- Vehicle tab now shows Supabase source, vehicle count, and read-only vehicle cards.
- Records tab now shows recent trips with vehicle-number mapping.
- Check tab now runs a read-only Supabase health check.
- Android export passed after this step.

## 2026-07-13 Clean rebuild step 2: manual trip start/end

- Added GPS-free manual trip start/end on the rebuild branch.
- Added Supabase write helpers for:
  - Starting trips with `vehicle_id`, `start_place`, `end_place`, and `status = in_progress`.
  - Completing trips with `end_place`, `end_time`, and `status = completed`.
- Updated the trip tab with vehicle selection, manual start/end inputs, active trip list, and manual completion buttons.
- Kept the stability rule: no GPS, WebView map, OBD/BLE, Reanimated, or new native permissions were added.
- Verification passed with `npm run verify` and Android export.

## 2026-07-13 Manual trip start_time fix

- Fixed build #99 trip-start failure where Supabase rejected inserts because `trips.start_time` was null.
- `startManualTrip()` now explicitly sends `start_time` as the current ISO timestamp.
- Verification passed with `npm run verify` and Android export.

## 2026-07-13 Unique APK release tags

- User still saw the same `start_time` error after installing from the old `build-99` release link.
- Confirmed the source already had the `start_time` fix.
- Updated the APK workflow to publish each APK under a unique `apk-${{ github.run_id }}` release tag instead of reusing `build-${{ github.run_number }}`.
- This prevents old release assets from being mistaken for the latest fixed APK.

## 2026-07-13 apk-29251409071 device success

- User installed the unique release APK `apk-29251409071`.
- Device test succeeded: app opens and manual trip controls respond.
- This is the confirmed step-2 baseline for continuing rebuild work.

## 2026-07-13 Clean rebuild step 2b: trip input fields

- Added manual trip fields for operator name, user name, and purpose.
- The app attempts to save these fields when DB columns exist.
- If the DB does not have `purpose`, `operator_name`, or `user_name`, the app falls back to the minimal trip insert so trip start remains usable.
- Records and active trip cards display the extended fields when available.
- No GPS, WebView map, OBD/BLE, Reanimated, or new native permissions were added.
- Verification passed with `npm run verify`, `npx expo-doctor`, and Android export.
- User tested `apk-29252766820` and reported normal operation.

## 2026-07-13 Android APK startup crash dependency pass

- Investigated the installed APK crash reported as Android's "app keeps stopping" dialog immediately after launch.
- Pulled the latest GitHub branch state through `981401e` and confirmed the local tree was clean before applying fixes.
- `adb devices -l` found no connected device in this session, so live `logcat` could not be captured.
- Found SDK 54 native dependency mismatches with `npx expo-doctor`:
  - `@react-native-async-storage/async-storage` was `3.1.1`; SDK 54 expects `2.2.0`.
  - `react-native-webview` was `14.0.1`; SDK 54 expects `13.15.0`.
- Ran `npx expo install @react-native-async-storage/async-storage react-native-webview` to pin SDK-compatible native module versions.
- Verification after the fix: `npx expo-doctor` passes 18/18 and `npm run verify` passes.

## 2026-07-13 Android APK startup crash BLE native removal

- User confirmed the same startup crash remained after build #94.
- Confirmed Android JS export succeeds, so the release bundle can be generated.
- Removed unused native BLE integration from the stability APK path:
  - Uninstalled `react-native-ble-plx`.
  - Removed the `react-native-ble-plx` config plugin from `app.json`.
  - Removed Android Bluetooth permissions from `app.json`.
- The current `lib/obd-ble.native.ts` remains a pure JS simulation/stub, so no JS import depends on `react-native-ble-plx`.
- Verification after removal: `npx expo-doctor` passes 18/18, `npm run verify` passes, and Android export passes.
- Next if this APK still crashes: capture device `adb logcat`; without it the remaining issue is likely another native startup module or Android build configuration problem.
# 2026-07-15 odometer sync from trips

- Vehicle current km now syncs from the latest trip odometer stored in Supabase.
- Vehicle tab loads `end_odometer` first, then `start_odometer` as a fallback, and merges the latest larger value into maintenance current km.
- Trip tab uses the same latest trip odometer merge before computing the automatic start odometer.
- This fixes cases where APK reinstall or another device lost local AsyncStorage current-km state.
- Note: standard OBD generally does not expose dashboard total odometer reliably; the app uses recorded trip odometer values as the durable source.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 remove bulk vehicle reset

- Removed the all-vehicle reset/initialization feature from the diagnosis tab.
- Kept only per-vehicle deletion with a destructive confirmation popup.
- Vehicle deletion now disconnects existing trip records from the vehicle instead of deleting trip history, then deletes the selected vehicle.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 vehicle deletion and Excel export controls

- Added selected-vehicle delete and all-vehicle reset controls to the diagnosis tab.
- Added Supabase helper functions to delete selected/all vehicles with related trip cleanup.
- Added schema updates for vehicle/trip delete policies and `trips.vehicle_id` nullability so deletion can work after DB migration is applied.
- Attempted to delete the currently registered Supabase vehicles (`1호차`, `3호차`, `5호차`, `7호차`, `111`, `222`), but the live DB blocked deletion because delete RLS/nullability migrations are not applied yet.
- Changed records export to open a period-setting popup and export Excel-compatible CSV data for the selected period.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 remove wiper maintenance item

- Removed `와이퍼` from periodic maintenance items so it no longer appears in the 정비 tab or maintenance alerts.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 diagnosis and maintenance balance fix

- Diagnosis ECU cards were restored to a larger internal-card layout after user feedback that the diagnosis screen looked too shrunken.
- Maintenance cards in the 정비 tab were reduced back toward the previous smaller size after user feedback that they became too large.
- Grouped engine-oil related items into one `엔진오일 세트` item because engine oil, oil filter, air filter, and fuel filter are commonly handled together.
- Added legacy migration so old engine-oil/filter completion km values can feed the new `engineOilSet` item.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 internal driver card sizing

- Fixed the previous driver layout mistake where only the outer card grew while the inner cards stayed short.
- Active trip inner sections are now taller: route panel, stat cards, OBD strip, and auto-odometer panel all have larger vertical height.
- Removed the oversized flexible blank spacer from the active trip card so the screen is filled by real content cards instead of empty space.
- Completion summary green card now stretches vertically, and each summary row has a larger minimum height.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 larger driver and maintenance cards

- Rechecked the recent user screenshots against the code.
- Increased active driver screen typography, route panel height, stat card height, OBD strip height, auto-odometer block height, and action button height.
- Increased completion-summary typography and spacing so the 월장비운행증 summary is easier to read.
- Increased maintenance item card height, value text size, detail text size, and completion button height in the 정비 tab.
- Removed leftover unused diagnosis styles for the old `ECU 감지 상태` bar to avoid confusion; the diagnosis screen now only keeps the compact heading status.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 driver fullscreen state layout

- Reworked active-trip and trip-completion driver screens to bypass the shared scroll container.
- Active trip now renders in a dedicated full-height driver screen, with the card taking the remaining screen space via `flex: 1`.
- Completion summary now uses a dedicated full-height driver screen so the summary and `새 운행 입력` button are spaced vertically instead of clustering at the top.
- This is intended to replace the earlier min-height-only attempts that did not visually change enough on device.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 driver active screen fill fix

- Active trip and completion summary screens now reserve a larger near-full-screen height.
- Added a flexible spacer inside the active trip card so the action buttons sit near the bottom instead of the whole screen looking clustered at the top.
- Completion summary now spaces the summary card and `새 운행 입력` button vertically to reduce the lower blank area.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 missed layout fixes

- Driver active-trip and completion screens now reserve nearly the full phone height so the lower area no longer looks empty after the bottom driver tab is hidden.
- Diagnosis vehicle dropdown can show a muted `차량 선택` label while still using the selected vehicle internally.
- Removed the bulky `ECU 감지 상태 / 미감지` status bar from diagnosis and replaced it with a small right-side `ECU 감지` / `연결 전` label.
- Diagnosis ECU cards are further compressed and only the first eight live ECU cards are shown in the primary view to fit the screen better.
- Maintenance tab no longer renders a bottom `새로고침` button that overlapped with the tab bar.
- Verification passed with `npm.cmd run verify`.

# 2026-07-17 compact mobile layout pass

- Driver mode now hides the bottom tab bar completely instead of showing a single 운행 tab.
- Shared `RebuildScreen` supports compact/no bottom spacing so driver, speed, and diagnosis screens waste less vertical space.
- Role selection cards are taller and now place `운전자용` / `관리자용` badges to the right of each mode title.
- Driver active-trip and completion-summary cards were tightened to reduce the large empty lower area.
- Speed tab layout was compressed: smaller map, tighter inputs, no extra refresh button, and the zone list now previews only the first two zones with a remainder count.
- Diagnosis tab layout was compressed: removed the extra bottom refresh button and reduced ECU card height.
- Verification passed with `npm.cmd run verify`.

# 2026-07-15 active trip button flow

- Driver trip screen now has a clear active/inactive split.
- When a trip is active, the start form is hidden and the screen shows a simple `운행 중` card.
- Removed the visible `진행 중 운행 N건` title from driver mode.
- The bottom primary action changes from `운행 시작` to `운행 종료` while a trip is active.
- Trip cancellation remains available as a secondary button inside the active trip card.
- Verification passed with `npm.cmd run verify`.

# 2026-07-14 vehicle workflow refinement

- Map WebView touch handling adjusted so the Leaflet map can be dragged while setting speed zones.
- Vehicle tab now uses a dropdown-driven single vehicle detail view instead of rendering every vehicle card at once.
- Added vehicle registration from the vehicle tab.
- Added fleet-wide maintenance due alerts so approaching replacement cycles are visible without opening every vehicle.
- Trip screen no longer shows vehicle-count/progress metrics in driver mode.
- Added operator rank input and split trip input into operator, route, and odometer sections.
- Trip start uses the selected vehicle's saved current km as the start odometer when the field is left blank.
- Trip completion updates the selected vehicle's current km when an end odometer is entered.
- Records screen now displays the latest OBD fuel percentage when available.
- Verification passed with `npm.cmd run verify`.

# 2026-07-14 map and driver-mode refinement

- Driver mode now shows only the 운행 tab; commander mode keeps 기록, 차량, 위치, 점검.
- Location map zone setup now supports a center crosshair and `중심 좌표 사용` button inside the map.
- Map selection mode also keeps tap-to-select for users who prefer direct tapping.
- Cards and metric blocks now have subtle shadows for a more polished light UI.
- 운행 screen now shows saved OBD device status and clarifies that it auto-connects when a trip starts.
- Verification passed with `npm.cmd run verify`.

# 2026-07-14 UI simplification pass

- Simplified the bottom tabs with restrained monochrome symbols: 운행, 기록, 차량, 위치, 점검.
- Hid the separate `monthly-log` tab because the user clarified that 기록 and 월장비운행증 are the same workflow.
- Added a shared `VehicleDropdown` component and replaced scattered vehicle pill buttons on 운행 and 기록 screens.
- Rewrote the 운행 and 기록 screen copy back to clean Korean in the touched files.
- Simplified shared card styling in `components/rebuild-screen.tsx` to reduce the busy rounded-card look.
- Verification passed with `npm.cmd run verify`.
## 2026-07-18 diagnosis vehicle dropdown selection

- Fixed diagnosis vehicle dropdown display: it no longer forces the label to `차량 선택` after a vehicle is selected.
- The dropdown now receives the actual `selectedVehicleId`, so selected state and displayed vehicle number stay aligned.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 compact records cards

- Restored compact records-list cards after the monthly-log metric tiles made each record too tall.
- The list now shows route plus one compact summary line, while detailed odometer/GPS/fuel fields remain in the detail popup and monthly export.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 unit filter transition fallback

- Fixed a transition issue after adding unit selection: existing test rows with `unit_code = null` were hidden, making tabs look changed or empty.
- Vehicle, trip, odometer, monthly-log, and speed-zone reads now include both the selected unit and legacy unassigned rows during migration.
- New writes still store the selected `unit_code` when the DB column exists.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 unit selection for field test

- Added 1862/5969 unit selection to the mode-selection screen, with persistent AsyncStorage storage and an edit button.
- Driver and commander mode entry now requires a selected unit before continuing.
- Vehicle, trip, odometer, and speed-zone reads/writes now use the selected `unit_code` when the Supabase schema supports it, with legacy fallback before migration is applied.
- `docs/schema.sql` now includes `unit_code` columns/indexes for `vehicles`, `trips`, and `speed_zones`, plus seed rows for `1862부대` and `5969부대`.
- Verification passed with `npm.cmd run verify`.

## 2026-07-18 monthly log daily export

- Records cards now show monthly-log metrics directly: odometer total, odometer trip distance, GPS actual distance, and fuel used.
- Monthly equipment operation export now outputs a daily document structure by trip date, with a per-day total row for trip count, odometer trip distance, and actual GPS distance.
- The export keeps the period popup and Excel-compatible CSV sharing behavior.

## 2026-07-18 cleanup audit

- Documented the pending Supabase schema migration as a must-remind item for later.
- Confirmed ignored local Expo export-check folders and Expo start logs are not tracked by Git and do not affect GitHub/APK builds.
- Confirmed the current intended vehicle-deletion UX is per-vehicle delete only, with confirmation, and no all-vehicle reset feature.
