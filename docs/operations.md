# 운영 절차

## 개발 서버 실행

PC 웹 확인:

```powershell
npm.cmd run start:offline
```

Android Expo Go 실기기 확인:

```powershell
npm.cmd run start:lan
```

기본 웹 주소:

```text
http://localhost:8082/
```

휴대폰 확인 시 PC와 Android 휴대폰은 같은 Wi-Fi에 연결되어 있어야 한다.

점검 탭 라우트는 `/check`이다. `/status`는 Expo Metro 내부 상태 엔드포인트와 충돌하므로 사용하지 않는다.

## Supabase 설정 확인

`.env.local`에 아래 값을 설정하면 앱이 환경변수 기준으로 Supabase에 연결된다.
값은 Supabase Project Settings > API에서 확인한다.

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

점검 화면(`/check`)에서 Supabase 호스트와 설정 출처를 확인한다. 운영 또는 다른 PC에서는 설정 출처가 `환경변수`로 표시되어야 한다. `.env.local`을 수정한 뒤에는 Expo 서버를 다시 시작한다. `fallback 개발값`으로 표시되면 `lib/supabase.js`의 개발 DB fallback을 사용 중인 상태다. `환경변수 오류 fallback`으로 표시되면 `EXPO_PUBLIC_SUPABASE_URL`이 올바른 `http` 또는 `https` URL인지 확인한다.

## 검증

```powershell
npm.cmd run source-check
npx.cmd eslint . --no-cache
npx.cmd tsc --noEmit
npm.cmd run health
```

또는:

```powershell
npm.cmd run verify
```

`npm.cmd run health`는 Expo 서버가 켜진 상태에서 운행, 기록, 차량, 점검 화면 응답을 확인한다.
특정 운행 상세 화면까지 확인하려면 `EXPO_HEALTH_TRIP_ID`에 운행 ID를 지정한 뒤 실행한다.
첫 번들링이 느린 PC에서는 `EXPO_HEALTH_TIMEOUT_MS`와 `EXPO_HEALTH_RETRY_DELAY_MS` 환경변수로 health 타임아웃과 재시도 대기 시간을 조정할 수 있다. 응답 크기 기준은 `EXPO_HEALTH_MIN_BYTES`로 조정한다.
`npm.cmd run source-check`는 한글 깨짐, 시스템명 누락, `/status` 라우트 재생성을 확인한다.

## 실기기 확인 순서

1. `npm.cmd run start:lan` 실행 후 Android Expo Go에서 QR 스캔
2. 위치 권한 허용
3. 차량 선택
4. 출발지/목적지 입력 또는 프리셋 선택
5. 출발
6. 위치 수집 대기
7. 종료
8. 기록, 상세, 점검 화면에서 저장 결과 확인

## 음성 입력

- 웹 브라우저에서는 출발지/목적지 옆 `음성` 버튼으로 브라우저 음성 인식을 사용할 수 있다.
- 마이크 권한이 차단되면 브라우저 주소창의 사이트 권한에서 마이크를 허용한 뒤 다시 시도한다.
- Android Expo Go에서는 기본 앱만으로 음성 인식 모듈을 안정적으로 사용할 수 없으므로, 현재는 안내 메시지를 표시한다.
- 실기기에서 네이티브 음성 인식이 필요하면 개발 빌드 또는 별도 음성 인식 모듈 도입이 필요하다.
- 앱 설정에는 위치 권한 문구와 마이크 권한 문구를 함께 둔다. 개발 빌드로 음성 모듈을 붙일 때 같은 설명을 재사용할 수 있다.

## 문제 대응

- 위치 권한이 거부되면 Android 설정에서 Expo Go의 위치 권한을 다시 허용한다.
- 운행 기록은 있는데 점검 화면의 GPS가 0이면 위치 권한, `gps_points` 테이블, Supabase RLS/insert 정책을 확인한다.
- 네트워크 연결 실패 또는 요청 시간 초과가 반복되면 인터넷 연결, Supabase URL, Supabase 프로젝트 상태를 확인한다.
- 진행 중 운행이 남으면 운행 탭에서 복구 후 종료하거나 상세 화면에서 무효 처리한다.
- 차량번호를 잘못 등록하면 차량 탭에서 수정한다.
- 운행 기록이 없는 차량만 삭제할 수 있다.
