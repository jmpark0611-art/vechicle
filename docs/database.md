# Supabase 운영 메모

## 사용 테이블

### vehicles

필수 컬럼:

- `id`: 차량 ID
- `vehicle_number`: 차량번호

앱 기능:

- 차량 목록 조회
- 차량 등록
- 차량번호 수정
- 운행 기록이 없는 차량 삭제

### trips

필수 컬럼:

- `id`: 운행 ID
- `vehicle_id`: 차량 ID
- `start_place`: 출발지
- `end_place`: 목적지
- `start_time`: 출발 시간
- `end_time`: 종료 시간
- `start_lat`, `start_lng`: 출발 좌표
- `end_lat`, `end_lng`: 종료 좌표
- `status`: 운행 상태

상태값:

- `in_progress`: 운행 중
- `completed`: 완료
- `canceled`: 잘못 시작한 운행 무효 처리

### gps_points

필수 컬럼:

- `trip_id`: 운행 ID
- `latitude`, `longitude`: 좌표
- `speed_kmh`: 속도
- `recorded_at`: 수집 시각

앱 기능:

- 운행 중 GPS 포인트 저장
- 운행 상세의 추정 거리 계산
- 운행 상세의 평균/최고 속도 계산
- 운행 상세의 첫 GPS, 최근 GPS, GPS 수집 구간 표시
- 기록/점검 화면의 GPS 수집 여부 확인

## 권장 인덱스

새 Supabase 환경을 만들 때는 `docs/schema.sql`을 기준으로 테이블, 상태값 제약, 인덱스를 함께 생성한다.

```sql
create index if not exists trips_status_start_time_idx on trips (status, start_time desc);
create index if not exists trips_vehicle_id_start_time_idx on trips (vehicle_id, start_time desc);
create index if not exists gps_points_trip_id_recorded_at_idx on gps_points (trip_id, recorded_at desc);
create unique index if not exists vehicles_vehicle_number_key on vehicles (vehicle_number);
```

## 운영 규칙

- 진행 중 운행이 여러 건이면 운행 탭은 가장 최근 운행을 복구한다.
- 8시간 이상 진행 중인 운행은 장시간 미종료 운행으로 표시한다.
- 잘못 시작한 운행은 삭제하지 않고 `canceled` 상태로 남긴다.
- 차량 삭제는 운행 기록이 0건인 차량에만 허용한다.
- 운행 상세 화면은 성능을 위해 최근 GPS 50개를 표시하며, 표시된 GPS 기준으로 상세 분석 값을 계산한다.
