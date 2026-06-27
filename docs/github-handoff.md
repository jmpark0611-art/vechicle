# GitHub 인수인계

## 협업 기준

- 기준 원본은 GitHub `main` 브랜치다.
- 현재 레포는 `https://github.com/jmpark0611-art/vechicle` 이고 기본 브랜치는 `main`이다.
- 로컬 미커밋 변경은 임시 작업으로 본다.
- 작업 시작 전 반드시 `main` 최신 상태를 pull/fetch한다.
- 작업 후 `npm.cmd run verify`를 통과시키고 `docs/handoff.md`, `docs/changelog.md`를 갱신한 뒤 커밋/푸시한다.
- 여러 AI가 이어서 작업할 때는 GitHub `main` 최신 커밋 해시와 남은 작업을 함께 전달한다.

## 현재 상태

현재 프로젝트 폴더 `my-sdk54-app`는 GitHub `jmpark0611-art/vechicle` 레포지토리의 `main` 브랜치와 연결되어 있다.

로컬 프로젝트 경로:

```text
C:\Users\a\Documents\Codex\2026-06-23\codex-codex-2\work\my-sdk54-app
```

사용자가 언급한 원격 정보:

```text
GitHub 레포: jmpark0611-art/mindsetup
작업 브랜치: claude/zealous-dirac-8wmt63
원격 컨테이너 경로: /home/user/mindsetup
```

## 다른 AI에게 바로 넘기는 방법

GitHub를 거치지 않아도 된다면 `my-sdk54-app` 폴더를 zip으로 압축해서 전달한다.

포함할 항목:

```text
app/
assets/
components/
constants/
docs/
hooks/
lib/
scripts/
app.json
package.json
package-lock.json
tsconfig.json
eslint.config.js
.env.example
README.md
AGENTS.md
CLAUDE.md
```

제외해도 되는 항목:

```text
node_modules/
.expo/
expo-start.out.log
expo-start.err.log
```

## GitHub에서 이어서 작업시키는 방법

다른 AI가 `jmpark0611-art/mindsetup` 레포지토리와 `claude/zealous-dirac-8wmt63` 브랜치에서 작업해야 한다면, 먼저 `my-sdk54-app`의 현재 파일들을 해당 레포/브랜치에 커밋하고 푸시해야 한다.

주의:

- 기존 GitHub 레포에 다른 코드가 있다면 덮어쓰기 전에 반드시 차이를 확인한다.
- `node_modules`, `.expo`, 로그 파일은 커밋하지 않는다.
- Supabase 운영 값은 `.env.local`로 관리하고 커밋하지 않는다.
- 커밋 후 다른 AI에게 `README.md`, `docs/handoff.md`, `docs/operations.md`, `docs/database.md`, `docs/schema.sql`을 먼저 읽으라고 전달한다.

## 다른 AI에게 보낼 메시지

```text
이 프로젝트는 Expo SDK 54 기반의 차량운행시스템입니다.

GitHub 레포:
jmpark0611-art/mindsetup

작업 브랜치:
claude/zealous-dirac-8wmt63

원격 컨테이너 경로:
/home/user/mindsetup

먼저 아래 문서를 읽고 이어서 작업해 주세요.
- README.md
- docs/handoff.md
- docs/operations.md
- docs/database.md
- docs/schema.sql
- docs/github-handoff.md
- docs/changelog.md

검증:
npm.cmd run verify
npm.cmd run health

실행:
npm.cmd run start:offline

Android Expo Go 실기기 확인:
npm.cmd run start:lan

주의:
- 앱 이름은 차량운행시스템입니다.
- 점검 화면은 /check 입니다.
- /status 라우트는 만들면 안 됩니다.
- 한글 깨짐 방지를 위해 npm.cmd run verify를 통과시켜 주세요.
- Supabase 기준 SQL은 docs/schema.sql 입니다.
- 운영 환경에서는 /check에서 Supabase 설정 출처가 환경변수로 표시되어야 합니다.
- 기록 화면은 기간/차량 필터와 GPS 누락 경고를 포함합니다.
- 운행 상세 화면은 GPS 수집 구간, 평균/최고 속도, GPS 품질 안내를 포함합니다.
- Expo 템플릿 reset-project 스크립트는 제거되어야 하며 source-check가 재생성을 막습니다.
```

## 다시 Codex에서 이어서 작업하는 방법

다른 AI가 GitHub에서 작업한 뒤에는 해당 브랜치의 변경분을 이 PC의 프로젝트 폴더에 반영해야 한다. 방법은 Git으로 pull하거나, zip 결과물을 받아 `my-sdk54-app`에 적용하는 것이다.

반영 후 아래 명령을 통과시키고 이어서 작업한다.

```powershell
npm.cmd run verify
npm.cmd run health
```
