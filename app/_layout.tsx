import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { getStoredRole } from '../lib/role';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    getStoredRole().then((role) => {
      if (!role) router.replace('/role-select');
    });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="role-select" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="trips/[id]" options={{ title: '운행 상세' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
