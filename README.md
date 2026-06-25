# 차량운행시스템

Expo SDK 54와 Supabase 기반의 차량 운행 기록 앱입니다. 운행 시작/종료, GPS 저장, 차량 관리, 운행 기록 조회, 점검 화면을 제공합니다.

## 실행

```bash
npm install
npm run start
```

기본 개발 서버는 Expo가 안내하는 주소를 사용합니다. 현재 로컬 검증 기준은 `http://localhost:8082`입니다.

## 환경변수

`.env.example`을 참고해 Supabase URL과 anon key를 설정합니다.

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

설정 출처와 연결 상태는 앱의 `점검` 탭에서 확인할 수 있습니다.

## 주요 기능

- `운행`: 차량 선택, 출발지/목적지 입력, 웹 음성 입력, 위치 권한 안내, 운행 시작/종료, GPS 저장 상태 표시
- `기록`: 상태/기간/차량/검색 필터, 요약 통계, CSV 내보내기, GPS 누락과 장시간 미종료 경고
- `차량`: 차량 등록/수정/삭제, 차량번호 중복 검사, 삭제 전 운행 기록 재확인, 차량별 운행 상태 표시
- `점검`: 앱/SDK 버전, Supabase 연결, GPS 경과, 중복 진행 운행, 실기기 확인 안내
- `운행 상세`: GPS 요약, 추정 거리, 평균/최고 속도, GPS 품질 안내, 지도 열기

## 검증

```bash
npm run verify
npm run health
```

`verify`는 한글 깨짐, 필수 문구, ESLint, TypeScript를 검사합니다. `health`는 로컬 Expo 웹 서버의 주요 라우트 응답을 확인합니다.

## 문서

- `docs/handoff.md`: 다음 작업자용 현재 상태와 주의사항
- `docs/changelog.md`: 변경 이력
- `docs/database.md`: Supabase 테이블 개요
- `docs/schema.sql`: 데이터베이스 스키마 예시
- `docs/github-handoff.md`: GitHub 이어받기 안내

## 주의

- Expo 템플릿 리셋 스크립트와 미사용 템플릿 화면은 제거했습니다.
- Android Expo Go에는 네이티브 음성 인식 모듈이 기본 포함되지 않아 현재 음성 입력은 웹 브라우저 중심입니다.
- `/status`는 Expo 내부 엔드포인트와 충돌할 수 있어 앱 점검 화면은 `/check`를 사용합니다.
