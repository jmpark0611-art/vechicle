# OBD 스캐너 연동 계획

## 장치 정보

| 항목 | 내용 |
|---|---|
| 모델 | Vgate iCar Pro (BT 4.0) |
| 프로토콜 | ELM327 (OBD-II AT commands) |
| 연결 방식 | Bluetooth Low Energy (BLE) |
| BLE Service UUID | `FFE0` (Vgate 공통) |
| BLE Characteristic UUID | `FFE1` (read/write/notify) |

## 현재 상태

현재 앱에는 **ELM327 응답 파서**와 정비 화면의 OBD 준비 안내가 들어가 있습니다.
BLE 스캔/연결 코드는 아직 넣지 않았고, 스캐너 도착 후 실기기에서 권한·연결·응답 포맷을 확인하며 붙입니다.
현재 차량 주행거리는 **수동 입력** 방식(정비 화면 상단 오도미터 섹션)으로 운용합니다.
`npm.cmd run verify`에는 `scripts/obd-parser-check.js`가 포함되어 샘플 ELM327 응답과 오류 응답을 자동 검증합니다.

---

## 구현 계획

### 1. 필요 패키지

```bash
npx expo install react-native-ble-plx
```

EAS 빌드 `app.json`에 플러그인 추가:

```json
{
  "plugins": [
    [
      "react-native-ble-plx",
      {
        "isBackgroundEnabled": false,
        "modes": ["peripheral", "central"],
        "bluetoothAlwaysPermission": "차량 정비 데이터 수신을 위해 Bluetooth 접근이 필요합니다."
      }
    ]
  ]
}
```

### 2. ELM327 주요 AT 명령

| 명령 | 설명 |
|---|---|
| `AT Z` | 리셋 |
| `AT E0` | 에코 끄기 |
| `AT L0` | 줄바꿈 끄기 |
| `AT SP 0` | 프로토콜 자동 감지 |
| `01 0C` | RPM (엔진 회전수) |
| `01 0D` | 차속 (km/h) |
| `01 A6` | 누적 주행거리 (SAE J1979-2, 지원 차량 한정) |

> **주의**: 오도미터 PID `01 A6`는 표준이지만 ECU가 지원해야 응답합니다.  
> 지원하지 않는 차량은 `NO DATA`를 반환합니다.

### 3. 코드 구조 (예정)

```
lib/obd/
  elm327.ts           ← ELM327 초기화 명령, Mode 01 응답 파싱, 01 A6 오도미터 km 변환
  ble-manager.ts      ← BleManager 싱글턴, 권한 요청 (예정)
  obd-service.ts      ← 스캔→연결→초기화→PID 루프 상위 API (예정)
scripts/
  obd-parser-check.js ← elm327.ts 샘플 응답 자동 검증
```

### 4. 오도미터 연동 흐름

```
정비 화면 진입
  → OBD 준비 안내 표시
  → 스캐너 도착 후 OBD 연결 버튼 표시 (BLE 권한 있는 경우)
  → 스캔 → Vgate iCar Pro 선택 → 연결
  → AT Z → AT E0 → AT SP 0 → 01 A6 전송
  → 응답 파싱 → km 변환
  → vehicles.current_mileage_km 자동 저장
```

### 5. 지원 차량 확인

현대·기아 대부분의 2012년 이후 모델은 `01 A6`를 지원합니다.  
지원 여부는 실기기에서 직접 테스트 필요.  
미지원 시 fallback: 수동 입력 유지.

---

## 권한 (app.json 추가 필요)

```json
"android": {
  "permissions": [
    "BLUETOOTH",
    "BLUETOOTH_ADMIN",
    "BLUETOOTH_SCAN",
    "BLUETOOTH_CONNECT",
    "ACCESS_FINE_LOCATION"
  ]
}
```

iOS는 `NSBluetoothAlwaysUsageDescription` Info.plist 키 필요 (react-native-ble-plx 플러그인이 자동 추가).

---

## 참고 자료

- [react-native-ble-plx GitHub](https://github.com/dotintent/react-native-ble-plx)
- [ELM327 AT Commands Reference](https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf)
- [OBD-II PID 목록 (Wikipedia)](https://en.wikipedia.org/wiki/OBD-II_PIDs)
- [Vgate iCar Pro BLE UUID 정보](https://forum.mgbsociety.co.uk/t/vgate-icar-pro-bluetooth-obdii) 
