import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  html?: string;
  style?: StyleProp<ViewStyle>;
  onMapTap?: (lat: number, lng: number) => void;
};

export function VehicleMap({ style }: Props) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.text}>지도 모듈은 2단계에서 다시 연결합니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E2E8F0' },
  text: { color: '#64748B', fontSize: 13, fontWeight: '800' },
});
