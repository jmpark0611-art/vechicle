import { RebuildScreen, SectionCard } from '@/components/rebuild-screen';

export default function MonthlyLogScreen() {
  return (
    <RebuildScreen
      title="운행증"
      subtitle="월별 차량 운행증과 CSV 출력 기능을 다시 연결할 화면입니다."
      metrics={[
        { label: '선택 월', value: '7월' },
        { label: '출력 대상', value: '0건' },
      ]}>
      <SectionCard title="월별 집계" body="차량별 운행 시작, 종료, 거리, 목적을 표로 정리합니다." />
      <SectionCard title="내보내기" body="웹과 APK에서 동일하게 테스트 가능한 출력 흐름을 다시 설계합니다." />
    </RebuildScreen>
  );
}
