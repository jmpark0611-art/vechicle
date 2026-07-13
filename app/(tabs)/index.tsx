import { Alert } from 'react-native';

import { RebuildScreen, SectionCard } from '@/components/rebuild-screen';

export default function TripScreen() {
  return (
    <RebuildScreen
      title="운행"
      subtitle="차량 선택, 운전자 정보, 출발지와 목적지를 한 화면에서 입력하는 운행 시작 화면입니다."
      metrics={[
        { label: 'GPS 상태', value: '대기' },
        { label: 'OBD 상태', value: '미연결' },
      ]}
      actionLabel="운행 시작"
      onAction={() => Alert.alert('재구축 1단계', '운행 저장 기능은 다음 단계에서 연결합니다.')}>
      <SectionCard title="차량 선택" body="등록 차량 목록을 연결한 뒤 차량번호와 장비명을 표시합니다." />
      <SectionCard title="운행 정보" body="운전자, 사용자, 목적, 출발지, 목적지를 입력하는 영역입니다." />
      <SectionCard title="안전 상태" body="GPS 정확도, 제한속도 구역, OBD 연결 상태를 이곳에 표시합니다." />
    </RebuildScreen>
  );
}
