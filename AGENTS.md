# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

---

# Progress Notes (for AI continuity)

## Stack
- Expo SDK 54 (React Native + Web, cross-platform)
- Expo Router (file-based routing, tabs layout)
- Supabase backend: tables `vehicles`, `trips`, `gps_points`
- expo-location ~19.0.8 (GPS tracking, already installed)
- react-native-webview ^14.0.1 (installed — for embedded map)

## Database Schema (Supabase)
- `vehicles`: id, vehicle_number, status, ...
- `trips`: id, vehicle_id (FK→vehicles), start_place, end_place, start_time, end_time, start_lat, start_lng, end_lat, end_lng, status ('in_progress'|'completed'|'canceled')
- `gps_points`: id, trip_id (FK→trips), latitude, longitude, speed_kmh, recorded_at

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

### Session 5 (Stabilization + Verify)
- `scripts/source-check.js` → check.tsx 필수 문구 "차량운행시스템 점검" → "시스템 점검" 갱신, trips/[id].tsx GPS 경로 필수 문구 4개 → "운행 상세"로 교체(경로 비공개 정책 반영)
- `app/(tabs)/explore.tsx` → tripActionBtn minHeight 42 → 44
- `app/(tabs)/vehicles.tsx` → actionBtn minHeight 42 → 44
- `app/(tabs)/_layout.tsx` → duplicate React import 수정 (import React, { useEffect, useState })
- `app/_layout.tsx` → SplashScreen.preventAutoHideAsync() 추가: 역할/PIN 확인 완료 전 스플래시 유지, flash 현상 제거
- `app/(tabs)/map.tsx` → isCommander !== true 조건으로 비사령관 Supabase 쿼리 차단
- `docs/handoff.md` → 역할 인증, PIN 잠금, 오프라인 큐, 지도, EAS 빌드 섹션 추가
- `docs/changelog.md` → 현재 작업본/이전 작업본 구분, 신규 기능 목록 추가

## Architecture Decisions
- **No route history anywhere**: gps_points table is write-only from driver's perspective; commanders only read latest point per active trip
- **Map stack**: react-native-webview (native) + iframe (web) both rendering Leaflet HTML from `lib/map-html.ts`
- **Map refresh**: client-side interval (30s), not real-time subscription (Supabase realtime not used to keep it simple)
- **No Google Maps API key needed**: OpenStreetMap tiles via Leaflet CDN (unpkg.com/leaflet@1.9.4)
- **Platform split**: `vehicle-map.native.tsx` / `vehicle-map.web.tsx` — Expo Router resolves automatically

## Working Branch
`claude/env-permissions-session-restart-154onb` on `jmpark0611-art/vechicle`
