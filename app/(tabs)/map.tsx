import { StyleSheet, Text, View } from 'react-native';

import { RebuildScreen, SectionCard } from '@/components/rebuild-screen';

export default function MapScreen() {
  return (
    <RebuildScreen
      title="실시간 위치"
      subtitle="운행 중 차량 위치와 수송부 제한속도 구역을 다시 붙일 화면입니다."
      metrics={[
        { label: '운행 차량', value: '0대' },
        { label: '제한구역', value: '0곳' },
      ]}>
      <View style={styles.mapMock}>
        <View style={[styles.marker, { left: '42%', top: '38%' }]}>
          <Text style={styles.markerLabel}>82바 1043</Text>
        </View>
        <View style={[styles.marker, styles.markerWarn, { left: '58%', top: '52%' }]}>
          <Text style={styles.markerLabel}>GPS 지연</Text>
        </View>
      </View>
      <SectionCard title="속도제한 구역" body="수송부가 지도에서 구역을 만들고 제한속도를 지정하는 기능을 다음 단계에서 연결합니다." />
    </RebuildScreen>
  );
}

const styles = StyleSheet.create({
  mapMock: {
    height: 260,
    borderRadius: 22,
    backgroundColor: '#E2E8F0',
    marginBottom: 14,
    overflow: 'hidden',
  },
  marker: {
    position: 'absolute',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#0F766E',
  },
  markerWarn: { backgroundColor: '#F59E0B' },
  markerLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
});
