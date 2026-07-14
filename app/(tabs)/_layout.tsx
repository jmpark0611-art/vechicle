import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStoredRole } from '@/lib/role';

const TAB_COLOR = '#2563EB';
const MUTED = '#94A3B8';

function TabGlyph({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: '900' }}>{label}</Text>;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [isCommander, setIsCommander] = useState(false);

  useEffect(() => {
    void getStoredRole().then((role) => setIsCommander(role === 'commander'));
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TAB_COLOR,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: insets.bottom + 10,
          height: 66,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: '#E2E8F0',
          backgroundColor: '#FFFFFF',
          elevation: 10,
          shadowColor: '#0F172A',
          shadowOpacity: 0.1,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: '운행', tabBarIcon: ({ color }) => <TabGlyph label="운" color={color} /> }} />
      <Tabs.Screen name="explore" options={{ title: '기록', tabBarIcon: ({ color }) => <TabGlyph label="기" color={color} /> }} />
      <Tabs.Screen name="vehicles" options={{ title: '차량', tabBarIcon: ({ color }) => <TabGlyph label="차" color={color} /> }} />
      <Tabs.Screen name="map" options={{ title: '위치', tabBarIcon: ({ color }) => <TabGlyph label="위" color={color} /> }} />
      <Tabs.Screen name="check" options={{ title: '점검', tabBarIcon: ({ color }) => <TabGlyph label="점" color={color} /> }} />
      <Tabs.Screen
        name="monthly-log"
        options={{
          title: '운행증',
          tabBarIcon: ({ color }) => <TabGlyph label="증" color={color} />,
          href: isCommander ? undefined : null,
        }}
      />
    </Tabs>
  );
}
