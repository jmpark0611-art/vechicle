import { RebuildScreen, SectionCard } from '@/components/rebuild-screen';

export default function RecordsScreen() {
  return (
    <RebuildScreen
      title="운행 기록"
      subtitle="수송부에서 전체 운행 기록을 확인하고 CSV, 기간 필터, 차량 필터를 사용할 화면입니다."
      metrics={[
        { label: '오늘 운행', value: '0건' },
        { label: '미종료', value: '0건' },
        { label: '평균 거리', value: '0km' },
        { label: 'GPS 누락', value: '0건' },
      ]}>
      <SectionCard title="카드형 기록" body="차량번호, 출발지, 목적지, 시간, 거리, 연료 사용량을 카드로 보여줍니다." />
      <SectionCard title="필터" body="전체, 운행중, 완료 상태와 기간, 차량 검색을 단계별로 다시 연결합니다." />
      <SectionCard title="운행증 출력" body="월별 운행증과 CSV 내보내기는 기록 기능 복구 후 연결합니다." />
    </RebuildScreen>
  );
}
