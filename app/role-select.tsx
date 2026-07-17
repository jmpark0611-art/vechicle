import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '@/lib/role';

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();

  async function chooseDriver() {
    await setStoredRole('driver');
    router.replace('/(tabs)');
  }

  async function chooseCommander() {
    router.replace('/commander-pin');
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>🚐</Text>
        </View>
        <Text style={styles.eyebrow}>Vehicle Operation</Text>
        <Text style={styles.title}>차량 운행관리</Text>
        <Text style={styles.subtitle}>사용할 모드를 선택하세요</Text>
      </View>

      <Pressable style={styles.card} onPress={() => void chooseDriver()}>
        <View style={[styles.cardIcon, styles.driverIcon]}>
          <Text style={styles.cardIconText}>▶️</Text>
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>운행 모드</Text>
          <Text style={styles.cardDesc}>운전자용 · 운행 시작과 종료</Text>
        </View>
      </Pressable>

      <Pressable style={styles.card} onPress={() => void chooseCommander()}>
        <View style={[styles.cardIcon, styles.commanderIcon]}>
          <Text style={styles.cardIconText}>🛠️</Text>
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>수송부 모드</Text>
          <Text style={styles.cardDesc}>관리자용 · 기록, 진단, 위치, 점검</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F5FB',
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    shadowColor: '#A7B0D8',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  logoText: { fontSize: 34 },
  eyebrow: { color: '#8A96B5', fontSize: 12, fontWeight: '900', marginBottom: 6 },
  title: { color: '#1E2946', fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: 2 },
  subtitle: { color: '#7180A3', fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  card: {
    minHeight: 128,
    backgroundColor: '#FFFDFB',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#A7B0D8',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  cardIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  driverIcon: { backgroundColor: '#EAF2FF' },
  commanderIcon: { backgroundColor: '#EAFBF4' },
  cardIconText: { fontSize: 25 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#1E2946', fontSize: 18, fontWeight: '900', marginBottom: 5 },
  cardDesc: { color: '#7180A3', fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
