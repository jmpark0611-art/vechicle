import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppRole, getStoredRole } from '../../lib/role';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const palette = Colors[colorScheme ?? 'light'];
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    getStoredRole().then(setRole);
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        tabBarInactiveTintColor: palette.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarIconStyle: {
          marginTop: 4,
        },
        tabBarItemStyle: {
          minHeight: 56,
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '800',
          lineHeight: 14,
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopColor: palette.border,
          borderTopWidth: 1,
          height: Math.max(insets.bottom + 64, 72),
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '운행',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: '기록',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="clock.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: '차량',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="car.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="check"
        options={{
          title: '점검',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '위치',
          href: role === 'commander' ? undefined : null,
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="map.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
