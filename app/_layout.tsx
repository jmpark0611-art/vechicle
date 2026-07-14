import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { getStoredRole } from '@/lib/role';

export const unstable_settings = {
  initialRouteName: 'role-select',
};

export default function RootLayout() {
  useEffect(() => {
    void getStoredRole().then((role) => {
      if (!role) {
        router.replace('/role-select');
      }
    });
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="role-select" />
        <Stack.Screen name="commander-pin" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
