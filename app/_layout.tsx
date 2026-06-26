import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { recordAppAccess } from '../lib/access-counter';
import { getStoredPin } from '../lib/commander-pin';
import { getStoredRole } from '../lib/role';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    (async () => {
      try {
        recordAppAccess();
        const role = await getStoredRole();
        if (!role) {
          router.replace('/role-select');
        } else if (role === 'commander') {
          const pin = await getStoredPin();
          if (pin) {
            router.replace('/commander-pin');
          }
        }
      } finally {
        SplashScreen.hideAsync();
      }
    })();
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
