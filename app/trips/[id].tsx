import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TripDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>이전</Text>
      </Pressable>
      <Text style={styles.title}>운행 상세</Text>
      <Text style={styles.subtitle}>상세 기록 기능은 다음 단계에서 다시 연결합니다.</Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>운행 ID</Text>
        <Text style={styles.cardValue}>{id ?? '대기'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC', paddingHorizontal: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 10, paddingRight: 16 },
  backText: { color: '#2563EB', fontSize: 15, fontWeight: '800' },
  title: { color: '#0F172A', fontSize: 28, fontWeight: '900', marginTop: 24 },
  subtitle: { color: '#64748B', fontSize: 14, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 18 },
  cardLabel: { color: '#64748B', fontSize: 12, fontWeight: '800', marginBottom: 8 },
  cardValue: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
});
