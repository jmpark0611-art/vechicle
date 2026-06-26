# 인수인계 메모

## 프로젝트

- 앱 이름: 차량운행시스템
- 기반: Expo SDK 54, Expo Router, Supabase
- 주요 경로: `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `app/(tabs)/vehicles.tsx`, `app/(tabs)/check.tsx`, `app/trips/[id].tsx`

## 현재 화면

- `운행`: 차량 선택, 출발지/목적지 입력, 프리셋, 웹 음성 입력과 마이크 권한 안내, 위치 권한 상태, 운행 시작/종료, 진행 중 운행 복구, 저장 타임아웃, GPS 저장 재시도와 저장 상태 표시
- `기록`: 30건 단위 더 보기 목록, 상태/기간/차량 필터, 검색, 필터 결과 요약 통계, 웹 CSV 내보내기, GPS 요약, GPS 누락 경고, 장시간 미종료 경고
- `차량`: 차량 등록/수정/삭제, 차량번호 중복 선검사, 삭제 전 DB 운행 기록 재확인, 차량별 exact 운행 수, 검색/상태 필터, 요약 통계, 차량별 운행 상태, 중복 미종료 운행 경고
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
- 하단 탭바도 `useSafeAreaInsets`로 홈 인디케이터 여백과 최소 터치 높이를 반영한다.
- 작은 Android/iPhone 폭에서 텍스트와 버튼이 잘리지 않도록 툴바, 카드 헤더, 정보 행, 주요 액션 행은 `flexWrap`과 `gap`을 사용한다.
- 긴 차량번호/장소/요약 값은 `numberOfLines`, `adjustsFontSizeToFit`, `minWidth: 0`으로 모바일 폭 안에 머물도록 처리한다.
- 기록/차량 필터 바는 작은 화면에서 2열로 감기도록 `flexBasis`와 `flexWrap`을 사용한다.
- 필터/chip/상세 버튼은 모바일 터치 편의성을 위해 최소 44px 높이를 기준으로 둔다.
- `source-check`는 주요 터치 버튼 스타일의 `minHeight`가 44px 미만으로 내려가면 실패 처리한다.
- 입력 화면의 ScrollView는 `automaticallyAdjustKeyboardInsets`, `keyboardDismissMode="on-drag"`, `keyboardShouldPersistTaps="handled"`로 모바일 키보드 사용성을 보강한다.
- 진행 중 운행이 이미 있으면 운행 시작 시 새 운행을 만들지 않고 기존 운행을 복구한다.
- 운행 화면은 최신 GPS 좌표를 ref로 보관해 위치 변경 때마다 대시보드 복구 로직이 불필요하게 재생성되지 않도록 했다.
- Supabase 요청은 `lib/request.ts`의 `withTimeout`을 거치며, 완료 후 내부 타이머를 정리한다.
