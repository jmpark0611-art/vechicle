import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '@/lib/role';
import { fetchUnits, getStoredUnitCode, getStoredUnitName, setStoredUnit, type UnitRecord } from '@/lib/unit';

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();
  const [units, setUnits] = useState<UnitRecord[]>([]);
  const [selectedUnitCode, setSelectedUnitCode] = useState<string | null>(null);
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [isEditingUnit, setIsEditingUnit] = useState(false);

  useEffect(() => {
    let alive = true;
    async function loadUnit() {
      const [nextUnits, storedCode, storedName] = await Promise.all([
        fetchUnits(),
        getStoredUnitCode(),
        getStoredUnitName(),
      ]);
      if (!alive) return;
      setUnits(nextUnits);
      if (storedCode) {
        setSelectedUnitCode(storedCode);
        setSelectedUnitName(storedName ?? nextUnits.find((unit) => unit.code === storedCode)?.name ?? storedCode);
        setIsEditingUnit(false);
      } else {
        setIsEditingUnit(true);
      }
    }
    void loadUnit();
    return () => {
      alive = false;
    };
  }, []);

  async function chooseUnit(unit: UnitRecord) {
    await setStoredUnit(unit.code, unit.name);
    setSelectedUnitCode(unit.code);
    setSelectedUnitName(unit.name);
    setIsEditingUnit(false);
  }

  function ensureUnitSelected() {
    if (selectedUnitCode) return true;
    Alert.alert('소속부대 설정 필요', '실제 테스트를 위해 먼저 1862부대 또는 5969부대를 선택해 주세요.');
    setIsEditingUnit(true);
    return false;
  }

  async function chooseDriver() {
    if (!ensureUnitSelected()) return;
    await setStoredRole('driver');
    router.replace('/(tabs)');
  }

  async function chooseCommander() {
    if (!ensureUnitSelected()) return;
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

      <View style={styles.unitCard}>
        <View style={styles.unitHeader}>
          <View>
            <Text style={styles.unitLabel}>소속부대</Text>
            <Text style={styles.unitValue}>{selectedUnitName ?? '부대를 선택하세요'}</Text>
          </View>
          {selectedUnitCode ? (
            <Pressable style={styles.unitEditBtn} onPress={() => setIsEditingUnit((value) => !value)}>
              <Text style={styles.unitEditText}>{isEditingUnit ? '닫기' : '수정'}</Text>
            </Pressable>
          ) : null}
        </View>
        {isEditingUnit ? (
          <View style={styles.unitOptions}>
            {units.map((unit) => (
              <Pressable
                key={unit.code}
                style={[styles.unitOption, selectedUnitCode === unit.code && styles.unitOptionActive]}
                onPress={() => void chooseUnit(unit)}>
                <Text style={[styles.unitOptionText, selectedUnitCode === unit.code && styles.unitOptionTextActive]}>
                  {unit.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Pressable style={styles.card} onPress={() => void chooseDriver()}>
        <View style={[styles.cardIcon, styles.driverIcon]}>
          <Text style={styles.cardIconText}>▶️</Text>
        </View>
        <View style={styles.cardCopy}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>운행 모드</Text>
            <Text style={styles.roleBadge}>운전자용</Text>
          </View>
          <Text style={styles.cardDesc}>운전자용 · 운행 시작과 종료</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </Pressable>

      <Pressable style={styles.card} onPress={() => void chooseCommander()}>
        <View style={[styles.cardIcon, styles.commanderIcon]}>
          <Text style={styles.cardIconText}>🛠️</Text>
        </View>
        <View style={styles.cardCopy}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>수송부 모드</Text>
            <Text style={[styles.roleBadge, styles.commanderBadge]}>관리자용</Text>
          </View>
          <Text style={styles.cardDesc}>관리자용 · 기록, 진단, 위치, 점검</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F0F4FB',
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DCEAF8',
    shadowColor: '#2563EB',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  logoText: { fontSize: 28 },
  eyebrow: { color: '#94A3B8', fontSize: 10, fontWeight: '600', marginBottom: 8, letterSpacing: 1.5, textTransform: 'uppercase' },
  title: { color: '#0F172A', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  subtitle: { color: '#64748B', fontSize: 14, fontWeight: '400', textAlign: 'center', marginTop: 10 },
  unitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  unitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  unitLabel: { color: '#64748B', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  unitValue: { color: '#0F172A', fontSize: 17, fontWeight: '700' },
  unitEditBtn: {
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  unitEditText: { color: '#2563EB', fontSize: 12, fontWeight: '600' },
  unitOptions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  unitOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#F5F8FF',
    borderWidth: 1,
    borderColor: '#DDE3F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitOptionActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  unitOptionText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  unitOptionTextActive: { color: '#FFFFFF' },
  card: {
    minHeight: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardIcon: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  driverIcon: { backgroundColor: '#EFF6FF' },
  commanderIcon: { backgroundColor: '#F0FDF4' },
  cardIconText: { fontSize: 22 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  cardTitle: { color: '#0F172A', fontSize: 18, fontWeight: '700', flexShrink: 0 },
  roleBadge: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  commanderBadge: { color: '#15803D', backgroundColor: '#F0FDF4' },
  cardDesc: { color: '#64748B', fontSize: 13, fontWeight: '400', lineHeight: 18 },
  cardChevron: { color: '#CBD5E1', fontSize: 28, fontWeight: '300', marginLeft: 6 },
});
