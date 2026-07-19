import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearStoredRole, getStoredRole, type AppRole } from '@/lib/role';

const ROLE_LABELS: Record<AppRole, string> = {
  driver: '운전자',
  commander: '수송부',
  admin: '관리자',
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
          {role === 'commander' ? <Text style={styles.pinHint}>수송부 PIN은 1862로 고정되어 있습니다.</Text> : null}
          {role === 'admin' ? <Text style={styles.pinHint}>관리자 PIN은 임시로 1862입니다.</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F0F4FB', paddingHorizontal: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 16,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { color: '#2563EB', fontSize: 22, fontWeight: '700' },
  title: { color: '#0F172A', fontSize: 20, fontWeight: '700' },
  content: { gap: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    padding: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', marginBottom: 12, letterSpacing: 0.5 },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  rolePillText: { color: '#1D4ED8', fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLabel: { color: '#0F172A', fontSize: 15, fontWeight: '600' },
  rowArrow: { color: '#94A3B8', fontSize: 20, fontWeight: '400' },
  pinHint: { color: '#94A3B8', fontSize: 12, fontWeight: '500', lineHeight: 18, marginTop: 8 },
});
