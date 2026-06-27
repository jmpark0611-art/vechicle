import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '../lib/role';

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectDriver = async () => {
    setIsLoading(true);
    try {
      await setStoredRole('driver');
      router.replace('/(tabs)');
    } catch {
      setIsLoading(false);
      Alert.alert('오류', '역할 저장에 실패했습니다. 다시 시도해 주세요.');
    }
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
        <View style={styles.cardTop}>
          <View style={styles.iconBubble}>
            <Text style={styles.roleIcon}>🚚</Text>
          </View>
          <View style={[styles.roleTag, styles.driverTag]}>
            <Text style={styles.driverTagText}>운전자</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>운전자 모드</Text>
        <Text style={styles.cardDesc}>차량 운행 시작·종료, 운행 기록 확인</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, styles.commanderCard]}
        onPress={handleSelectCommander}
        disabled={isLoading}
        activeOpacity={0.85}>
        <View style={styles.cardTop}>
          <View style={[styles.iconBubble, styles.commanderIconBubble]}>
            <Text style={styles.roleIcon}>🛡️</Text>
          </View>
          <View style={[styles.roleTag, styles.commanderTag]}>
            <Text style={styles.commanderTagText}>수송부 간부</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>수송부 간부 모드</Text>
        <Text style={styles.cardDesc}>차량 현재 위치 조회, 실시간 운행 현황 확인</Text>
        <Text style={styles.pinHint}>PIN 설정 후 입장</Text>
      </TouchableOpacity>

      {isLoading && (
        <ActivityIndicator style={styles.loader} color="#A8FF5F" size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101112',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
  },
  subtitle: {
    color: '#B7BDC5',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 22,
    marginBottom: 36,
  },
  card: {
    backgroundColor: '#1F2023',
    borderColor: '#30343A',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
    minHeight: 164,
    padding: 20,
  },
  commanderCard: {
    borderColor: '#476A2D',
    backgroundColor: '#20251F',
  },
  cardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  iconBubble: {
    alignItems: 'center',
    backgroundColor: '#0B0C0D',
    borderColor: '#3F463B',
    borderRadius: 30,
    borderWidth: 1,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  commanderIconBubble: {
    borderColor: '#5F8B32',
  },
  roleIcon: {
    fontSize: 32,
  },
  roleTag: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  driverTag: {
    backgroundColor: '#24331D',
  },
  driverTagText: {
    color: '#A8FF5F',
    fontSize: 12,
    fontWeight: '800',
  },
  commanderTag: {
    backgroundColor: '#2E421F',
  },
  commanderTagText: {
    color: '#C6FF7A',
    fontSize: 12,
    fontWeight: '800',
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  cardDesc: {
    color: '#BDC3CA',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  pinHint: {
    color: '#A8FF5F',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
  loader: {
    marginTop: 28,
  },
});
