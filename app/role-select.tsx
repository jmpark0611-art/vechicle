import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
        <MaterialCommunityIcons name="truck-fast" size={32} color="#FFFFFF" />
      </View>
      <Text style={styles.title}>차량관리시스템</Text>
      <Text style={styles.subtitle}>모드를 선택하세요</Text>

      <TouchableOpacity style={styles.card} onPress={handleDriver} activeOpacity={0.85}>
        <View style={[styles.accent, { backgroundColor: '#EFF6FF' }]}>
          <MaterialCommunityIcons name="steering" size={26} color="#2563EB" />
        </View>
        <Text style={styles.cardTitle}>운행 모드</Text>
        <Text style={styles.cardDesc}>운전자 · 운용자용{'\n'}운행 시작/종료</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.card, styles.commanderCard]} onPress={handleCommander} activeOpacity={0.85}>
        <View style={[styles.accent, { backgroundColor: '#F1F5F9' }]}>
          <MaterialIcons name="admin-panel-settings" size={26} color="#334155" />
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
});
