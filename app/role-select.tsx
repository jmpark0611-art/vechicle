import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ROLE_KEY = 'vehicle_system_role';

async function chooseRole(role: 'driver' | 'commander') {
  await AsyncStorage.setItem(ROLE_KEY, role);
  if (role === 'commander') {
    router.replace('/commander-pin');
    return;
  }
  router.replace('/(tabs)');
}

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.logo}>
        <Text style={styles.logoText}>차</Text>
      </View>
      <Text style={styles.title}>차량운행시스템</Text>
      <Text style={styles.subtitle}>모드를 선택하세요</Text>

      <Pressable style={styles.card} onPress={() => void chooseRole('driver')}>
        <View style={styles.cardIcon}>
          <Text style={styles.cardIconText}>운</Text>
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>운행 모드</Text>
          <Text style={styles.cardDesc}>운전자용 운행 시작, 종료, 내 기록 확인</Text>
        </View>
      </Pressable>

      <Pressable style={styles.card} onPress={() => void chooseRole('commander')}>
        <View style={[styles.cardIcon, styles.commanderIcon]}>
          <Text style={styles.cardIconText}>관</Text>
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>수송부 모드</Text>
          <Text style={styles.cardDesc}>기록 관리, 차량 진단, 위치와 제한구역 설정</Text>
        </View>
      </Pressable>

      <View style={styles.themeRow}>
        <View style={[styles.swatch, { backgroundColor: '#2563EB' }]} />
        <View style={[styles.swatch, { backgroundColor: '#0F766E' }]} />
        <View style={[styles.swatch, { backgroundColor: '#334155' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },
  logoText: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
  title: { color: '#0F172A', fontSize: 26, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: '#64748B', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 8, marginBottom: 34 },
  card: {
    minHeight: 132,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 22,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  commanderIcon: { backgroundColor: '#ECFDF5' },
  cardIconText: { color: '#2563EB', fontSize: 18, fontWeight: '900' },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#0F172A', fontSize: 19, fontWeight: '900', marginBottom: 8 },
  cardDesc: { color: '#64748B', fontSize: 13, fontWeight: '600', lineHeight: 19 },
  themeRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 24 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 4, borderColor: '#FFFFFF' },
});
