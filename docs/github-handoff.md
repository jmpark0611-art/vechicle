# GitHub 인수인계

## 현재 상태

현재 프로젝트는 GitHub 원격과 연결되어 있다.

로컬 프로젝트 경로:

```text
C:\Users\a\Documents\Codex\2026-06-23\codex-codex-2\work\my-sdk54-app
```

현재 원격 정보:

```text
GitHub 레포: jmpark0611-art/vechicle
현재 작업 브랜치: claude/env-permissions-session-restart-154onb
기준 커밋: 25ef841 이후 작업
```

## 현재 작업 방향

- 과거 다크+라임 UI는 기준에서 제외한다.
- 현재 기준은 `Vehicle system UI improvement.zip`의 라이트/딥네이비 하이파이 디자인이다.
- 첨부 화면 기준:
  - 역할 선택: 중앙 로고, `운행 모드`/`수송부 모드` 카드, 테마 점 UI.
  - 운행: `차량 선택` → `운행 정보` → `경로` 카드 순서.
  - 기록: 카드형/리스트형 토글.
  - 차량: `차량 진단`, OBD 상태, ECU 데이터, DTC, 소모품 교환주기.
  - 위치: 라이트 지도 패널, 운행 중 차량 리스트.
- `25ef841`에서 `expo-linear-gradient`가 추가되었으므로 새 APK/EAS 빌드가 필요하다.

## GitHub에서 이어서 작업시키는 방법

다른 AI는 아래 브랜치에서 이어서 작업해야 한다.

```bash
git clone https://github.com/jmpark0611-art/vechicle.git
cd vechicle
git checkout claude/env-permissions-session-restart-154onb
npm.cmd install
npm.cmd run verify
```

## 다른 AI에게 보낼 메시지

```text
이 프로젝트는 Expo SDK 54 기반의 차량운행시스템입니다.

GitHub 레포:
jmpark0611-art/vechicle

작업 브랜치:
claude/env-permissions-session-restart-154onb

먼저 아래 문서를 읽고 이어서 작업해 주세요.
- README.md
- docs/handoff.md
- docs/demo-parity.md
- docs/operations.md
- docs/database.md
- docs/schema.sql
- docs/github-handoff.md
- docs/changelog.md

검증:
npm.cmd run verify

실행:
npm.cmd run start:offline

Android Expo Go 실기기 확인:
npm.cmd run start:lan

주의:
- 현재 UI 기준은 Vehicle system UI improvement.zip의 라이트/딥네이비 디자인입니다.
- 과거 다크+라임 UI로 되돌리지 마세요.
- 현재 브랜치의 최신 작업은 역할 선택/운행 시작 화면을 첨부 이미지 기준으로 정리하는 작업입니다.
- 운행 시작 전 OBD 진단 카드는 제거했고, OBD는 /obd 및 차량 진단 화면에서 다룹니다.
- /status 라우트는 만들면 안 됩니다. 점검 화면은 /check 입니다.
- 한글 깨짐 방지를 위해 npm.cmd run verify를 통과시켜 주세요.
- Supabase 기준 SQL은 docs/schema.sql 입니다.
```

## 다시 Codex에서 이어서 작업하는 방법

다른 AI가 GitHub에서 작업한 뒤에는 해당 브랜치의 변경분을 이 PC의 프로젝트 폴더에 반영해야 한다. 방법은 Git으로 pull하거나, zip 결과물을 받아 `my-sdk54-app`에 적용하는 것이다.

반영 후 아래 명령을 통과시키고 이어서 작업한다.

```powershell
npm.cmd run verify
npm.cmd run health
```
