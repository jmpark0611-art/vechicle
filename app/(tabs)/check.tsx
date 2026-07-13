import Constants from 'expo-constants';

import { RebuildScreen, SectionCard } from '@/components/rebuild-screen';

export default function CheckScreen() {
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? '54';

  return (
    <RebuildScreen
      title="시스템 점검"
      subtitle="APK 실행 안정화 이후 Supabase, GPS, 권한, OBD 상태 점검을 다시 연결합니다."
      metrics={[
        { label: 'Expo SDK', value: sdkVersion },
        { label: '앱 상태', value: '정상' },
      ]}>
      <SectionCard title="1단계 점검" body="이 빌드는 앱 시작 안정성 확인을 위한 클린 재구축 버전입니다." />
      <SectionCard title="다음 점검" body="실기기에서 앱이 열리면 Supabase 연결, 운행 저장, GPS 권한을 순서대로 복구합니다." />
    </RebuildScreen>
  );
}
