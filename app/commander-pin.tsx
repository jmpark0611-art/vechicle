import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStoredPin, setStoredPin, verifyPin } from '../lib/commander-pin';
import { setStoredRole } from '../lib/role';

type Phase =
  | 'setup-enter'
  | 'setup-confirm'
  | 'verify'
  | 'change-verify'
  | 'change-enter'
  | 'change-confirm';

const PHASE_SUBTITLE: Record<Phase, string> = {
  'setup-enter': 'PIN 4자리를 설정해 주세요',
  'setup-confirm': 'PIN을 한 번 더 입력해 주세요',
  'verify': 'PIN을 입력해 주세요',
  'change-verify': '현재 PIN을 입력해 주세요',
  'change-enter': '새 PIN 4자리를 입력해 주세요',
  'change-confirm': '새 PIN을 한 번 더 입력해 주세요',
};

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function CommanderPinScreen() {
  const insets = useSafeAreaInsets();
  const { change } = useLocalSearchParams<{ change?: string }>();
  const isChangeMode = change === '1';

  const [phase, setPhase] = useState<Phase | null>(null);
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [digits, setDigits] = useState<string[]>([]);
  const [tempPin, setTempPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const processingRef = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await getStoredPin();
      if (isChangeMode) {
        setPhase('change-verify');
      } else if (stored) {
        setPhase('verify');
      } else {
        setPhase('setup-enter');
        setIsFirstSetup(true);
      }
    })();
  }, [isChangeMode]);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const processPin = useCallback(
    async (pin: string, currentPhase: Phase, currentTempPin: string) => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        switch (currentPhase) {
          case 'verify': {
            const ok = await verifyPin(pin);
            if (ok) {
              try {
                await setStoredRole('commander');
              } catch {
                // role write failure is non-fatal; proceed anyway
              }
              router.replace('/(tabs)');
            } else {
              setError('PIN이 올바르지 않습니다.');
              shake();
              setDigits([]);
            }
            break;
          }
          case 'setup-enter': {
            setTempPin(pin);
            setDigits([]);
            setError(null);
            setPhase('setup-confirm');
            break;
          }
          case 'setup-confirm': {
            if (pin === currentTempPin) {
              try {
                await setStoredPin(pin);
                await setStoredRole('commander');
              } catch {
                setError('저장 중 오류가 발생했습니다. 다시 시도하세요.');
                shake();
                setDigits([]);
                setTempPin('');
                setPhase('setup-enter');
                break;
              }
              router.replace('/(tabs)');
            } else {
              setError('PIN이 일치하지 않습니다. 처음부터 다시 시도하세요.');
              shake();
              setDigits([]);
              setTempPin('');
              setPhase('setup-enter');
            }
            break;
          }
          case 'change-verify': {
            const ok = await verifyPin(pin);
            if (ok) {
              setDigits([]);
              setError(null);
              setPhase('change-enter');
            } else {
              setError('PIN이 올바르지 않습니다.');
              shake();
              setDigits([]);
            }
            break;
          }
          case 'change-enter': {
            setTempPin(pin);
            setDigits([]);
            setError(null);
            setPhase('change-confirm');
            break;
          }
          case 'change-confirm': {
            if (pin === currentTempPin) {
              try {
                await setStoredPin(pin);
              } catch {
                setError('저장 중 오류가 발생했습니다. 다시 시도하세요.');
                shake();
                setDigits([]);
                setTempPin('');
                setPhase('change-enter');
                break;
              }
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)');
              }
            } else {
              setError('PIN이 일치하지 않습니다. 다시 시도하세요.');
              shake();
              setDigits([]);
              setTempPin('');
              setPhase('change-enter');
            }
            break;
          }
        }
      } finally {
        processingRef.current = false;
      }
    },
    [shake]
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (!phase || processingRef.current) return;
      setDigits((prev) => {
        if (prev.length >= 4) return prev;
        const next = [...prev, d];
        if (next.length === 4) {
          const pin = next.join('');
          setTimeout(() => processPin(pin, phase, tempPin), 120);
        }
        return next;
      });
      setError(null);
    },
    [phase, tempPin, processPin]
  );

  const handleDelete = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
    setError(null);
  }, []);

  if (!phase) return null;

  const showBackButton = isFirstSetup && (phase === 'setup-enter' || phase === 'setup-confirm');

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 },
      ]}>
      <View style={styles.iconBubble}>
        <Text style={styles.headerIcon}>🔐</Text>
      </View>
      <Text style={styles.title}>수송부 간부</Text>
      <Text style={styles.subtitle}>{PHASE_SUBTITLE[phase]}</Text>

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
              if (!key) {
                return <View key={ki} style={styles.padKeyEmpty} />;
              }
              if (key === '⌫') {
                return (
                  <TouchableOpacity
                    key={ki}
                    style={styles.padKey}
                    onPress={handleDelete}
                    activeOpacity={0.6}>
                    <Text style={styles.deleteText}>⌫</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={ki}
                  style={styles.padKey}
                  onPress={() => handleDigit(key)}
                  activeOpacity={0.7}>
                  <Text style={styles.keyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {showBackButton && (
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/role-select')}>
          <Text style={styles.backText}>역할 선택으로 돌아가기</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#101112',
    flex: 1,
    paddingHorizontal: 32,
  },
  iconBubble: {
    alignItems: 'center',
    backgroundColor: '#1F2023',
    borderColor: '#3F463B',
    borderRadius: 34,
    borderWidth: 1,
    height: 68,
    justifyContent: 'center',
    marginBottom: 16,
    width: 68,
  },
  headerIcon: {
    fontSize: 36,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#B7BDC5',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 44,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 20,
  },
  dot: {
    backgroundColor: 'transparent',
    borderColor: '#4B5563',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    width: 20,
  },
  dotFilled: {
    backgroundColor: '#A8FF5F',
    borderColor: '#A8FF5F',
  },
  error: {
    color: '#FF7B7B',
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
    backgroundColor: '#1F2023',
    borderColor: '#30343A',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    height: 72,
    justifyContent: 'center',
  },
  padKeyEmpty: {
    flex: 1,
    height: 72,
  },
  keyText: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '700',
  },
  deleteText: {
    color: '#A8FF5F',
    fontSize: 22,
  },
  backBtn: {
    marginTop: 36,
    paddingVertical: 8,
  },
  backText: {
    color: '#A8FF5F',
    fontSize: 14,
    fontWeight: '700',
  },
});
