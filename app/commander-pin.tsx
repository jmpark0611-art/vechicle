import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { verifyPin } from '../lib/commander-pin';
import { setStoredRole } from '../lib/role';

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function CommanderPinScreen() {
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const processingRef = useRef(false);

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
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const ok = await verifyPin(pin);
        if (ok) {
          await setStoredRole('commander');
          router.replace('/(tabs)');
        } else {
          setError('비밀번호가 올바르지 않습니다.');
          shake();
          setDigits([]);
        }
      } finally {
        processingRef.current = false;
      }
    },
    [shake]
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (processingRef.current) return;
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
    [processPin]
  );

  const handleDelete = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
    setError(null);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.lockIcon}>
        <Text style={styles.lockEmoji}>🔒</Text>
      </View>
      <Text style={styles.title}>수송부 모드</Text>
      <Text style={styles.subtitle}>비밀번호를 입력하세요</Text>

      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < digits.length && styles.dotFilled]} />
        ))}
      </Animated.View>

      {error ? (
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
  lockEmoji: {
    fontSize: 26,
  },
  title: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 52,
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
