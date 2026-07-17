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
  unitCard: {
    backgroundColor: '#FFFDFB',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#A7B0D8',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  unitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  unitLabel: { color: '#8A96B5', fontSize: 12, fontWeight: '900', marginBottom: 4 },
  unitValue: { color: '#1E2946', fontSize: 18, fontWeight: '900' },
  unitEditBtn: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: '#EEF3FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  unitEditText: { color: '#3158E8', fontSize: 12, fontWeight: '900' },
  unitOptions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  unitOption: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    backgroundColor: '#F4F7FF',
    borderWidth: 1,
    borderColor: '#E6ECFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitOptionActive: { backgroundColor: '#3158E8', borderColor: '#3158E8' },
  unitOptionText: { color: '#52607D', fontSize: 14, fontWeight: '900' },
  unitOptionTextActive: { color: '#FFFFFF' },
  card: {
    minHeight: 154,
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
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  cardTitle: { color: '#1E2946', fontSize: 20, fontWeight: '900', flexShrink: 0 },
  roleBadge: {
    color: '#3158E8',
    fontSize: 12,
    fontWeight: '900',
    backgroundColor: '#EDF4FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  commanderBadge: { color: '#13866F', backgroundColor: '#EAFBF4' },
  cardDesc: { color: '#7180A3', fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
