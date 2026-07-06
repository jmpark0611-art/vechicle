import { router } from 'expo-router';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '../lib/role';

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();

  const handleDriver = async () => {
    await setStoredRole('driver');
    router.replace('/(tabs)');
  };

  const handleCommander = () => {
    router.replace('/commander-pin');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.logoBox}>
        <Text style={styles.logoIcon}>▰</Text>
      </View>
      <Text style={styles.title}>차량관리시스템</Text>
      <Text style={styles.subtitle}>모드를 선택하세요</Text>

      <TouchableOpacity style={styles.card} onPress={handleDriver} activeOpacity={0.85}>
        <View style={[styles.accent, { backgroundColor: '#EFF6FF' }]}>
          <Text style={styles.accentIcon}>🏠</Text>
        </View>
        <Text style={styles.cardTitle}>운행 모드</Text>
        <Text style={styles.cardDesc}>운전자 · 운용자용{'\n'}운행 시작/종료</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.card, styles.commanderCard]} onPress={handleCommander} activeOpacity={0.85}>
        <View style={[styles.accent, { backgroundColor: '#F1F5F9' }]}>
          <Text style={styles.accentIcon}>📋</Text>
        </View>
        <Text style={styles.cardTitle}>수송부 모드</Text>
        <Text style={styles.cardDesc}>관리자용{'\n'}기록·차량 진단·위치 관리</Text>
        <Text style={styles.pinHint}>비밀번호 입력 후 입장</Text>
      </TouchableOpacity>

      <View style={styles.themeRow}>
        <Text style={styles.themeLabel}>테마</Text>
        <View style={[styles.themeDot, styles.themeDotActive]} />
        <View style={[styles.themeDot, styles.themeDotGreen]} />
        <View style={[styles.themeDot, styles.themeDotSlate]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  logoBox: {
    width: 64,
    height: 64,
    backgroundColor: '#2563EB',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    alignSelf: 'center',
  },
  logoIcon: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  title: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 48,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginBottom: 16,
    minHeight: 164,
    padding: 26,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  commanderCard: {
    borderColor: '#CBD5E1',
  },
  accent: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  accentIcon: {
    fontSize: 21,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  cardDesc: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
  },
  pinHint: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  themeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 26,
  },
  themeLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  themeDot: {
    borderRadius: 20,
    height: 34,
    width: 34,
  },
  themeDotActive: {
    backgroundColor: '#2563EB',
    borderColor: '#111827',
    borderWidth: 4,
  },
  themeDotGreen: {
    backgroundColor: '#16A34A',
  },
  themeDotSlate: {
    backgroundColor: '#475569',
  },
});
