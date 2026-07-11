import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '../lib/role';
import { fetchUnits, getStoredUnitCode, getStoredUnitName, setStoredUnit, UnitRecord } from '../lib/unit';

const THEME_KEY = 'app_theme_color';
const THEMES = [
  { key: 'blue',  color: '#2563EB', label: '파랑' },
  { key: 'olive', color: '#3D6B47', label: '군녹' },
  { key: 'navy',  color: '#1E3A8A', label: '남색' },
] as const;
type ThemeKey = typeof THEMES[number]['key'];

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();
  const [theme, setTheme] = useState<ThemeKey>('blue');
  const [units, setUnits] = useState<UnitRecord[]>([]);
  const [selectedUnitCode, setSelectedUnitCode] = useState<string | null>(null);
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [unitModalVisible, setUnitModalVisible] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === 'blue' || v === 'olive' || v === 'navy') setTheme(v);
    });
    getStoredUnitCode().then((code) => {
      if (code) setSelectedUnitCode(code);
    });
    getStoredUnitName().then((name) => {
      if (name) setSelectedUnitName(name);
    });
    fetchUnits()
      .then(setUnits)
      .catch(() => setUnits([]))
      .finally(() => setLoadingUnits(false));
  }, []);

  const primaryColor = THEMES.find((t) => t.key === theme)?.color ?? '#2563EB';

  const handleTheme = async (key: ThemeKey) => {
    setTheme(key);
    await AsyncStorage.setItem(THEME_KEY, key);
  };

  const handleSelectUnit = async (unit: UnitRecord) => {
    setSelectedUnitCode(unit.code);
    setSelectedUnitName(unit.name);
    await setStoredUnit(unit.code, unit.name);
    setUnitModalVisible(false);
  };

  const handleDriver = async () => {
    if (!selectedUnitCode) {
      Alert.alert('부대 선택 필요', '소속 부대를 먼저 선택해 주세요.');
      return;
    }
    await setStoredRole('driver');
    router.replace('/(tabs)');
  };

  const handleCommander = () => {
    if (!selectedUnitCode) {
      Alert.alert('부대 선택 필요', '소속 부대를 먼저 선택해 주세요.');
      return;
    }
    router.replace('/commander-pin');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}>
      {/* 색상 테마 선택 — 우측 상단 */}
      <View style={[styles.themeRow, { top: insets.top + 14, right: 20 }]}>
        {THEMES.map((t) => (
          <TouchableOpacity
            key={t.key}
            accessibilityLabel={`${t.label} 테마`}
            style={[styles.themeSquare, { backgroundColor: t.color }, theme === t.key && styles.themeSquareActive]}
            onPress={() => handleTheme(t.key)}>
            {theme === t.key && <Text style={styles.themeCheck}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.logoBox, { backgroundColor: primaryColor }]}>
        <MaterialCommunityIcons name="truck-fast" size={32} color="#FFFFFF" />
      </View>
      <Text style={styles.title}>차량관리시스템</Text>
      <Text style={styles.subtitle}>모드를 선택하세요</Text>

      {/* 부대 선택 */}
      <TouchableOpacity
        style={[styles.unitSelector, selectedUnitCode && styles.unitSelectorSelected]}
        onPress={() => setUnitModalVisible(true)}
        activeOpacity={0.85}>
        <MaterialIcons name="domain" size={18} color={selectedUnitCode ? primaryColor : '#94A3B8'} />
        <Text style={[styles.unitSelectorText, selectedUnitCode && { color: '#0F172A' }]}>
          {selectedUnitCode ? selectedUnitName ?? selectedUnitCode : '소속 부대 선택 (필수)'}
        </Text>
        <MaterialIcons name="keyboard-arrow-down" size={18} color="#94A3B8" />
      </TouchableOpacity>

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
        <Text style={styles.pinHint}>부대 비밀번호 입력 후 입장</Text>
      </TouchableOpacity>

      {/* 부대 선택 모달 */}
      <Modal visible={unitModalVisible} transparent animationType="slide" onRequestClose={() => setUnitModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setUnitModalVisible(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>소속 부대 선택</Text>
            {loadingUnits ? (
              <ActivityIndicator color="#2563EB" style={{ marginVertical: 24 }} />
            ) : units.length === 0 ? (
              <Text style={styles.modalEmpty}>등록된 부대가 없습니다.{'\n'}Supabase units 테이블에 부대를 등록해 주세요.</Text>
            ) : (
              <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
                {units.map((unit) => (
                  <TouchableOpacity
                    key={unit.code}
                    style={[styles.modalItem, selectedUnitCode === unit.code && styles.modalItemActive]}
                    onPress={() => handleSelectUnit(unit)}>
                    <Text style={[styles.modalItemText, selectedUnitCode === unit.code && styles.modalItemTextActive]}>
                      {unit.name}
                    </Text>
                    {selectedUnitCode === unit.code && (
                      <MaterialIcons name="check" size={18} color="#2563EB" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
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
  themeRow: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
  },
  themeSquare: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeSquareActive: {
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
  },
  themeCheck: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  logoBox: {
    width: 64,
    height: 64,
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
    marginBottom: 20,
  },
  unitSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  unitSelectorSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  unitSelectorText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginBottom: 16,
    minHeight: 140,
    padding: 24,
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
    marginBottom: 14,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '60%',
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalList: {
    maxHeight: 300,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalItemActive: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  modalItemText: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '600',
  },
  modalItemTextActive: {
    color: '#2563EB',
  },
  modalEmpty: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    paddingVertical: 24,
  },
});
