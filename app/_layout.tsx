import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

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
