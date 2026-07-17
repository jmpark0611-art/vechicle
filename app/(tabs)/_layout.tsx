import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStoredRole, type AppRole } from '@/lib/role';

const ACTIVE = '#5B7CFA';
const MUTED = '#9AA8C7';

function TabGlyph({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: '900' }}>{label}</Text>;
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
    return <View style={{ flex: 1, backgroundColor: '#F4F5FB' }} />;
  }

  return (
    <Tabs
      initialRouteName={isCommander ? 'explore' : 'index'}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 10,
          height: isDriver ? 58 : 64,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: '#E7EAF8',
          backgroundColor: '#FFFDFB',
          elevation: 10,
          shadowColor: '#9AA8C7',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
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
