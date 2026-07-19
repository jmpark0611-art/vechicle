import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStoredRole, type AppRole } from '@/lib/role';

const ACTIVE = '#2563EB';
const MUTED = '#94A3B8';

function TabGlyph({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: '600' }}>{label}</Text>;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<AppRole | null>(null);
  const isCommander = role === 'commander';
  const isDriver = role === 'driver';

  useEffect(() => {
    void getStoredRole().then(setRole);
  }, []);

  if (role === null) {
    return <View style={{ flex: 1, backgroundColor: '#F0F4FB' }} />;
  }

  return (
    <Tabs
      initialRouteName={isCommander ? 'explore' : 'index'}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          display: isDriver ? 'none' : 'flex',
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 10,
          height: isDriver ? 58 : 64,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: '#DCEAF8',
          backgroundColor: '#FFFFFF',
          elevation: 12,
          shadowColor: '#2563EB',
          shadowOpacity: 0.12,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: '운행', tabBarIcon: ({ color }) => <TabGlyph label="▶" color={color} />, href: isDriver ? undefined : null }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: '기록', tabBarIcon: ({ color }) => <TabGlyph label="☰" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{ title: '진단', tabBarIcon: ({ color }) => <TabGlyph label="▣" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="alerts"
        options={{ title: '정비', tabBarIcon: ({ color }) => <TabGlyph label="!" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: '속도', tabBarIcon: ({ color }) => <TabGlyph label="⚡" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="check"
        options={{ title: '점검', tabBarIcon: ({ color }) => <TabGlyph label="✓" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen name="monthly-log" options={{ title: '기록', href: null }} />
    </Tabs>
  );
}
