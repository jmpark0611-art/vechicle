import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStoredRole, type AppRole } from '@/lib/role';

const ACTIVE = '#2563EB';
const MUTED = '#94A3B8';

function TabGlyph({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: '900' }}>{label}</Text>;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<AppRole | null>(null);
  const isCommander = role === 'commander';

  useEffect(() => {
    void getStoredRole().then(setRole);
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 10,
          height: role === 'driver' ? 58 : 64,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: '#E2E8F0',
          backgroundColor: '#FFFFFF',
          elevation: 10,
          shadowColor: '#0F172A',
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: '운행', tabBarIcon: ({ color }) => <TabGlyph label="▶" color={color} /> }} />
      <Tabs.Screen
        name="explore"
        options={{ title: '기록', tabBarIcon: ({ color }) => <TabGlyph label="≡" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{ title: '차량', tabBarIcon: ({ color }) => <TabGlyph label="▣" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '위치',
          tabBarIcon: ({ color }) => <TabGlyph label="⌖" color={color} />,
          href: isCommander ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="check"
        options={{ title: '점검', tabBarIcon: ({ color }) => <TabGlyph label="✓" color={color} />, href: isCommander ? undefined : null }}
      />
      <Tabs.Screen
        name="monthly-log"
        options={{
          title: '기록',
          href: null,
        }}
      />
    </Tabs>
  );
}
