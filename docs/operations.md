# 운영 절차

## EAS Android 빌드

### 사전 조건

```bash
npm install -g eas-cli
eas login          # Expo 계정으로 로그인
```

### app.json 확인 사항

| 항목 | 현재 값 | 비고 |
|---|---|---|
| `android.package` | `com.vehicle.tracking` | EAS 필수 |
| `scheme` | `vehicletracking` | 딥링크용 |
| `slug` | `my-sdk54-app` | EAS 프로젝트 식별자 — 변경 시 EAS 대시보드에서 재연결 필요 |
| `version` | `1.0.0` | production 빌드는 autoIncrement로 자동 증가 |

> `owner` 필드가 없으면 첫 `eas build` 실행 시 계정에 자동 연결된다. 팀 공유 시 `"owner": "<expo-username>"` 추가 필요.

### 빌드 명령

```bash
# APK (내부 테스트, Expo Go 없이 설치 가능)
eas build --profile preview --platform android

# AAB (스토어 배포)
eas build --profile production --platform android
```

### 네이티브 의존성 EAS 호환성

| 패키지 | 버전 | 새 아키텍처 | 비고 |
|---|---|---|---|
| `expo-location` | ~19.0.8 | ✅ | 플러그인 설정 완료 |
| `expo-secure-store` | ^56.0.4 | ✅ | 플러그인 불필요(기본 옵션) |
| `react-native-webview` | ^14.0.1 | ✅ | 자동 링크 |
| `@react-native-async-storage/async-storage` | ^3.1.1 | ✅ | 자동 링크 |
| `react-native-reanimated` | ~4.1.1 | ✅ | React Compiler 호환 |

### 권한

`app.json`에 선언된 권한:
- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` — GPS 운행 기록
- `RECORD_AUDIO` — 음성 입력(웹 브라우저 중심, 추후 네이티브 확장 대비)
- iOS: `NSLocationWhenInUseUsageDescription`, `NSMicrophoneUsageDescription`

---

## 개발 서버 실행

```bash
npm ci                   # 의존성 설치
npm run start:offline    # 오프라인(캐시) 모드
npm run start:lan        # LAN — Android/iPhone Expo Go 실기기 연결
```

기본 URL: `http://localhost:8082/`

---

## Supabase 설정

### 환경변수 (`.env.local`)

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

설정 출처는 앱 `점검` 탭에서 확인 (`환경변수` / `fallback 개발값` / `환경변수 오류 fallback`).

### RLS 정책 현황

| 테이블 | RLS | 정책 |
|---|---|---|
| `vehicles` | 활성화 | anon SELECT · INSERT · UPDATE · DELETE |
| `trips` | 활성화 | anon SELECT · INSERT · UPDATE · DELETE |
| `gps_points` | 활성화 | anon SELECT · INSERT |

기준 SQL: `docs/schema.sql` (RLS 정책 포함).

새 Supabase 프로젝트에 적용:
```sql
-- Supabase 대시보드 SQL Editor 또는 CLI로 docs/schema.sql 전체 실행
```

### Realtime 구독 (관제 지도)

`map.tsx`는 `gps_points INSERT`와 `trips *` 이벤트를 구독한다. Supabase 프로젝트에서 해당 테이블의 Realtime이 활성화되어 있어야 한다.

Supabase 대시보드 → Database → Replication → `supabase_realtime` publication에 `gps_points`, `trips` 포함 여부 확인.

---

## PIN / 역할 설정

### 초기 설정 흐름

```
앱 최초 실행
  └─ 역할 미설정 → /role-select
       ├─ 운전자 선택 → AsyncStorage @app_role = 'driver' → /(tabs)
       └─ 수송부 간부 선택 → /commander-pin (setup 모드)
            └─ PIN 4자리 설정 → SecureStore 'commander_pin'
                → AsyncStorage @app_role = 'commander' → /(tabs)
```

### 재진입 흐름 (수송부 간부)

```
앱 재시작
  └─ role = 'commander' + PIN 저장됨 → /commander-pin (verify 모드)
       ├─ PIN 일치 → /(tabs)
       └─ PIN 불일치 → 오류 메시지 + 재시도
```

### PIN 변경

`점검` 탭 → `PIN 변경` 버튼 → `/commander-pin?change=1`

### 역할 초기화

`점검` 탭 → `역할 변경` 버튼 → AsyncStorage `@app_role` 삭제 → /role-select

> PIN(`commander_pin` in SecureStore)은 역할 초기화 시 자동 삭제되지 않는다. 필요 시 `점검` 탭에서 `PIN 변경` 후 역할 변경.

---

## GPS 큐 문제 대응

### 증상

운행 화면에 "미전송 N건" 표시 또는 점검 탭 `GPS 대기 큐` 항목이 0이 아닌 경우.

### 원인과 조치

| 원인 | 확인 방법 | 조치 |
|---|---|---|
| Supabase RLS 미설정 | 점검 탭 Supabase 연결 상태 | `docs/schema.sql` 재적용 |
| 네트워크 단절 | 앱 포그라운드 복귀 시 자동 재전송 | 별도 조치 불필요 |
| 큐 포화(200개 초과) | 점검 탭 GPS 대기 큐 개수 | 네트워크 복구 시 최근 200개만 재전송 |

---

## 관제 지도 (GPS 상태 기준)

`위치` 탭(수송부 간부 전용) 차량 목록 뱃지 기준:

| 뱃지 | 의미 | 기준 |
|---|---|---|
| (없음) | GPS 정상 | 최근 5분 이내 수신 |
| `오래됨` (노란색) | GPS 지연 | 5분 ~ 30분 전 수신 |
| `오래됨` (빨간색) | GPS 장기 지연 | 30분 이상 전 수신 |
| `미수신` | GPS 포인트 없음 | 운행 중이나 GPS 미전송 |
| `장시간` | 장시간 운행 | 운행 시작 8시간 이상 경과 |

---

## 검증 명령

```bash
npm run verify    # source-check + ESLint + tsc --noEmit
npm run health    # Expo 웹 서버 주요 라우트 응답 확인
```

`EXPO_HEALTH_TRIP_ID=<uuid>` 환경변수를 설정하면 `/trips/[id]` 상세 응답도 함께 확인한다.
