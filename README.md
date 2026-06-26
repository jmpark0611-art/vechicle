# 차량운행시스템

Expo SDK 54와 Supabase 기반의 차량 운행 기록 앱입니다. 운전자용 운행 시작/종료·GPS 저장과 수송부 간부용 실시간 차량 위치 조회를 제공합니다.

## 실행

```bash
npm ci
npm run start:offline    # 개발 서버 (오프라인 캐시)
npm run start:lan        # LAN — Android/iPhone Expo Go 실기기 연결
```

기본 URL: `http://localhost:8082/`

## 환경변수

`.env.local`에 Supabase 정보를 설정합니다.

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

설정 출처와 연결 상태는 앱 `점검` 탭에서 확인할 수 있습니다.

## 역할

앱은 두 가지 역할을 지원합니다.

- **운전자**: 차량 선택, 출발지/목적지 입력, 운행 시작/종료, 운행 기록 조회
- **수송부 간부**: 운전자 기능 + 실시간 차량 위치 지도(PIN 잠금)

첫 실행 시 역할 선택 화면이 나타납니다. 수송부 간부는 4자리 PIN 설정 후 진입합니다.

## 주요 화면

| 화면 | 역할 | 설명 |
|---|---|---|
| 운행 | 운전자 | 차량 선택, 운행 시작/종료, GPS 저장 상태 |
| 기록 | 운전자 | 운행 목록, 필터, CSV 내보내기(웹) |
| 차량 | 공통 | 차량 등록/수정/삭제, 운행 통계 |
| 점검 | 공통 | Supabase 연결, GPS 큐 상태, PIN/역할 관리 |
| 위치 | 간부 전용 | Leaflet 지도, 차량별 GPS 상태, 경보 뱃지 |

## 검증

```bash
npm run verify    # source-check + ESLint + TypeScript
npm run health    # Expo 웹 서버 라우트 응답 확인
```

## Android 빌드 (EAS)

```bash
npm install -g eas-cli
eas login
eas build --profile preview --platform android   # APK (내부 테스트)
eas build --profile production --platform android # AAB (스토어 배포)
```

상세 빌드·운영 절차는 `docs/operations.md` 참고.

## 문서

| 파일 | 내용 |
|---|---|
| `docs/handoff.md` | 현재 상태, 아키텍처, 주의사항 |
| `docs/changelog.md` | 변경 이력 |
| `docs/operations.md` | EAS 빌드, Supabase 설정, PIN/역할, GPS 큐 대응 |
| `docs/schema.sql` | DB 스키마 + RLS 정책 |
| `docs/github-handoff.md` | GitHub 이어받기 안내 |

## 주의

- Expo 템플릿 리셋 스크립트와 미사용 템플릿 화면은 제거했습니다.
- `/status`는 Expo 내부 엔드포인트와 충돌할 수 있어 앱 점검 화면은 `/check`를 사용합니다.
- GPS 이동 경로/동선은 운전자·간부 모두에게 비공개입니다. 간부는 현재 위치만 조회합니다.
- Android Expo Go에는 네이티브 음성 인식 모듈이 기본 포함되지 않아 음성 입력은 웹 브라우저 중심입니다.
