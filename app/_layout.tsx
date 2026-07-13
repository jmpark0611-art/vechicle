import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

// 릴리즈 빌드에서 JS 에러를 화면에 표시 (진단용)
if (typeof ErrorUtils !== 'undefined') {
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    const msg = `[${isFatal ? 'FATAL' : 'ERROR'}]\n${error?.message ?? String(error)}\n\n${error?.stack ?? ''}`;
    Alert.alert('앱 오류 (진단)', msg.slice(0, 800));
  });
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // 매 실행마다 모드 선택 화면으로 시작
    router.replace('/role-select');
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="role-select" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="commander-pin" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="trips/[id]" options={{ title: '운행 상세' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
