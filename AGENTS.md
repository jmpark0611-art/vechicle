# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

---

# Progress Notes (for AI continuity)

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

## Working Branch
`claude/env-permissions-session-restart-154onb` on `jmpark0611-art/vechicle`
