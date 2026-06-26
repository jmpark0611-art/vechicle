import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '../lib/role';

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectDriver = async () => {
    setIsLoading(true);
    await setStoredRole('driver');
    router.replace('/(tabs)');
  };

  const handleSelectCommander = () => {
    router.replace('/commander-pin');
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
      ]}>
      <Text style={styles.title}>사용자 유형 선택</Text>
      <Text style={styles.subtitle}>
        이 기기의 사용 목적에 맞는 유형을 선택해 주세요.{'\n'}나중에 점검 탭에서 변경할 수 있습니다.
      </Text>

      <TouchableOpacity
        style={styles.card}
        onPress={handleSelectDriver}
        disabled={isLoading}
        activeOpacity={0.85}>
        <View style={[styles.roleTag, styles.driverTag]}>
          <Text style={styles.driverTagText}>운전자</Text>
        </View>
        <Text style={styles.cardTitle}>운전자 모드</Text>
        <Text style={styles.cardDesc}>차량 운행 시작·종료, 운행 기록 확인</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, styles.commanderCard]}
        onPress={handleSelectCommander}
        disabled={isLoading}
        activeOpacity={0.85}>
        <View style={[styles.roleTag, styles.commanderTag]}>
          <Text style={styles.commanderTagText}>수송부 간부</Text>
        </View>
        <Text style={styles.cardTitle}>수송부 간부 모드</Text>
        <Text style={styles.cardDesc}>차량 현재 위치 조회, 실시간 운행 현황 확인</Text>
        <Text style={styles.pinHint}>PIN 설정 후 입장</Text>
      </TouchableOpacity>

      {isLoading && (
        <ActivityIndicator style={styles.loader} color="#2563EB" size="large" />
      )}
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
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 10,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 22,
    marginBottom: 36,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 16,
    padding: 24,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  commanderCard: {
    borderColor: '#BFDBFE',
    borderWidth: 1.5,
  },
  roleTag: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  driverTag: {
    backgroundColor: '#F0FDF4',
  },
  driverTagText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },
  commanderTag: {
    backgroundColor: '#EFF6FF',
  },
  commanderTagText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardDesc: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  pinHint: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  loader: {
    marginTop: 28,
  },
});
