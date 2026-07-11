import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setStoredRole } from '../lib/role';
import { getStoredUnitCode, getStoredUnitName, verifyCommanderPin } from '../lib/unit';

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function CommanderPinScreen() {
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unitName, setUnitName] = useState<string>('');
  const [unitCode, setUnitCode] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const processingRef = useRef(false);

  useEffect(() => {
    Promise.all([getStoredUnitCode(), getStoredUnitName()]).then(([code, name]) => {
      setUnitCode(code);
      setUnitName(name ?? code ?? '');
    });
  }, []);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const processPin = useCallback(
    async (pin: string) => {
      if (processingRef.current || !unitCode) return;
      processingRef.current = true;
      setVerifying(true);
      try {
        const ok = await verifyCommanderPin(unitCode, pin);
        if (ok) {
          await setStoredRole('commander');
          router.replace('/(tabs)/explore');
        } else {
          setError('비밀번호가 올바르지 않습니다.');
          shake();
          setDigits([]);
        }
      } catch {
        setError('서버 연결 실패. 네트워크를 확인해 주세요.');
        shake();
        setDigits([]);
      } finally {
        processingRef.current = false;
        setVerifying(false);
      }
    },
    [unitCode, shake]
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (processingRef.current || verifying) return;
      setDigits((prev) => {
        if (prev.length >= 4) return prev;
        const next = [...prev, d];
        if (next.length === 4) {
          setTimeout(() => processPin(next.join('')), 120);
        }
        return next;
      });
      setError(null);
    },
    [processPin, verifying]
  );

  const handleDelete = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
    setError(null);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.lockIcon}>
        <MaterialIcons name="lock" size={28} color="#FFFFFF" />
      </View>
      <Text style={styles.title}>수송부 모드</Text>
      {unitName ? (
        <Text style={styles.unitLabel}>{unitName}</Text>
      ) : null}
      <Text style={styles.subtitle}>비밀번호를 입력하세요</Text>

      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < digits.length && styles.dotFilled]} />
        ))}
      </Animated.View>

      {verifying ? (
        <ActivityIndicator color="#2563EB" style={{ marginBottom: 20 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <View style={styles.errorPlaceholder} />
      )}

      <View style={styles.pad}>
        {[0, 1, 2, 3].map((row) => (
          <View key={row} style={styles.padRow}>
            {NUMPAD_KEYS.slice(row * 3, row * 3 + 3).map((key, ki) => {
              if (!key) return <View key={ki} style={styles.padKeyEmpty} />;
              if (key === '⌫') {
                return (
                  <TouchableOpacity key={ki} style={styles.padKey} onPress={handleDelete} activeOpacity={0.6}>
                    <Text style={styles.deleteText}>⌫</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity key={ki} style={styles.padKey} onPress={() => handleDigit(key)} activeOpacity={0.7}>
                  <Text style={styles.keyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/role-select')}>
        <Text style={styles.backText}>모드 선택으로 돌아가기</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    paddingHorizontal: 32,
  },
  lockIcon: {
    width: 56,
    height: 56,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
  },
  unitLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 48,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 20,
  },
  dot: {
    backgroundColor: 'transparent',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    width: 20,
  },
  dotFilled: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  error: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 20,
    textAlign: 'center',
  },
  errorPlaceholder: {
    height: 38,
  },
  pad: {
    maxWidth: 288,
    width: '100%',
  },
  padRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  padKey: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    elevation: 2,
    flex: 1,
    height: 72,
    justifyContent: 'center',
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 8,
  },
  padKeyEmpty: {
    flex: 1,
    height: 72,
  },
  keyText: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '500',
  },
  deleteText: {
    color: '#64748B',
    fontSize: 22,
  },
  backBtn: {
    marginTop: 36,
    paddingVertical: 8,
  },
  backText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
});
