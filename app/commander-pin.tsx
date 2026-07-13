import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PIN = '0000';

export default function CommanderPinScreen() {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('수송부 비밀번호를 입력하세요');

  function pressDigit(digit: string) {
    const next = (input + digit).slice(0, 4);
    setInput(next);
    if (next.length === 4) {
      if (next === PIN) {
        router.replace('/(tabs)/explore');
        return;
      }
      setInput('');
      setMessage('비밀번호가 맞지 않습니다');
    }
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'del'];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 26, paddingBottom: insets.bottom + 24 }]}>
      <Pressable style={styles.back} onPress={() => router.replace('/role-select')}>
        <Text style={styles.backText}>이전</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.label}>수송부 모드</Text>
        <Text style={styles.title}>PIN 입력</Text>
        <Text style={styles.message}>{message}</Text>
      </View>

      <View style={styles.dots}>
        {[0, 1, 2, 3].map((idx) => (
          <View key={idx} style={[styles.dot, idx < input.length && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.pad}>
        {keys.map((key) => (
          <Pressable
            key={key}
            style={[styles.key, key === 'back' && styles.keyGhost]}
            onPress={() => {
              if (key === 'back') {
                router.replace('/role-select');
              } else if (key === 'del') {
                setInput((v) => v.slice(0, -1));
              } else {
                pressDigit(key);
              }
            }}>
            <Text style={[styles.keyText, key === 'back' && styles.keyGhostText]}>
              {key === 'back' ? '취소' : key === 'del' ? '←' : key}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC', paddingHorizontal: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 10, paddingRight: 16 },
  backText: { color: '#2563EB', fontSize: 15, fontWeight: '800' },
  header: { alignItems: 'center', marginTop: 40 },
  label: { color: '#64748B', fontSize: 13, fontWeight: '800', marginBottom: 8 },
  title: { color: '#0F172A', fontSize: 30, fontWeight: '900' },
  message: { color: '#64748B', fontSize: 14, fontWeight: '700', marginTop: 10 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 44, marginBottom: 42 },
  dot: { width: 15, height: 15, borderRadius: 8, backgroundColor: '#CBD5E1' },
  dotActive: { backgroundColor: '#2563EB' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  key: {
    width: '29%',
    aspectRatio: 1.3,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { color: '#0F172A', fontSize: 24, fontWeight: '900' },
  keyGhostText: { color: '#64748B', fontSize: 15 },
});
