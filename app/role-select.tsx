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
        <Text style={styles.logoIcon}>🚗</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  logoBox: {
    width: 56,
    height: 56,
    backgroundColor: '#2563EB',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    alignSelf: 'center',
  },
  logoIcon: {
    fontSize: 26,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 36,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 14,
    padding: 22,
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
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  accentIcon: {
    fontSize: 20,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 5,
  },
  cardDesc: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 20,
  },
  pinHint: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
});
