import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/lib/background-location';

export const unstable_settings = {
  initialRouteName: 'role-select',
};

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="role-select" />
        <Stack.Screen name="commander-pin" />
        <Stack.Screen name="admin-pin" />
        <Stack.Screen name="mode-settings" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
