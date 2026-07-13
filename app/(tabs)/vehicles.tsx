import { RebuildScreen, SectionCard } from '@/components/rebuild-screen';

export default function VehiclesScreen() {
  return (
    <RebuildScreen
      title="차량 진단"
      subtitle="차량 등록, 소모품 교체주기, OBD 진단 정보를 다시 붙일 화면입니다."
      metrics={[
        { label: '등록 차량', value: '0대' },
        { label: '정비 예정', value: '0건' },
        { label: 'OBD', value: '대기' },
        { label: 'DTC', value: '정상' },
      ]}>
      <SectionCard title="차량 목록" body="차량번호, 장비명, 유종, 누적 주행거리를 표시합니다." />
      <SectionCard title="소모품 교체" body="엔진오일, 오일필터, 에어필터 교체완료 버튼을 다음 단계에서 연결합니다." />
      <SectionCard title="OBD 스캐너" body="APK 안정화 후 Bluetooth 권한과 실제 ELM327 연결을 별도 단계로 복구합니다." />
    </RebuildScreen>
  );
}
