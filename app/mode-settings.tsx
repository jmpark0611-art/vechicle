import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearStoredRole, getStoredRole, type AppRole } from '@/lib/role';

const ROLE_LABELS: Record<AppRole, string> = {
  driver: '운전자',
  commander: '수송부',
};

export default function ModeSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    void getStoredRole().then(setRole);
  }, []);

  const handleChangeRole = useCallback(() => {
    Alert.alert('모드 변경', '역할을 변경하면 다시 선택 화면으로 이동합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '변경',
        style: 'destructive',
        onPress: async () => {
          await clearStoredRole();
          router.replace('/role-select');
        },
      },
    ]);
  }, []);

  const handleChangePin = useCallback(() => {
    router.push('/commander-pin?change=1');
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <Text style={styles.title}>모드 설정</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>현재 모드</Text>
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>{role ? ROLE_LABELS[role] : '미설정'}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>계정</Text>
          <Pressable style={styles.row} onPress={handleChangeRole}>
            <Text style={styles.rowLabel}>모드 변경</Text>
            <Text style={styles.rowArrow}>›</Text>
          </Pressable>
          {role === 'commander' ? (
            <Pressable style={[styles.row, styles.rowBorder]} onPress={handleChangePin}>
              <Text style={styles.rowLabel}>PIN 변경</Text>
              <Text style={styles.rowArrow}>›</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F5FB', paddingHorizontal: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 16,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { color: '#4F6AE6', fontSize: 22, fontWeight: '700' },
  title: { color: '#1A2340', fontSize: 20, fontWeight: '900' },
  content: { gap: 10 },
  card: {
    backgroundColor: '#FFFDFB',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 16,
    shadowColor: '#B0B8D8',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardLabel: { color: '#7B86A8', fontSize: 11, fontWeight: '800', marginBottom: 12, letterSpacing: 0.5 },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  rolePillText: { color: '#4F6AE6', fontSize: 14, fontWeight: '900' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F0F2FA',
  },
  rowLabel: { color: '#24304F', fontSize: 15, fontWeight: '800' },
  rowArrow: { color: '#B0B8D8', fontSize: 20, fontWeight: '400' },
});
