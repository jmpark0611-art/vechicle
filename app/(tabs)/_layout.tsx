import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { TabIcon } from '@/components/ui/tab-icon';
import { NAV } from '@/constants/theme';
import { AppRole, getStoredRole } from '../../lib/role';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    getStoredRole().then(setRole);
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: NAV.accent,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.3)',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          position: 'absolute',
          bottom: insets.bottom + 10,
          left: 14,
          right: 14,
          borderRadius: 26,
          height: 66,
          backgroundColor: '#0B1C2E',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.09)',
          elevation: 20,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 20,
        },
        tabBarItemStyle: {
          borderRadius: 18,
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          lineHeight: 13,
          marginTop: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '운행',
          tabBarIcon: ({ color }) => <TabIcon name="trip" size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: '기록',
          tabBarIcon: ({ color }) => <TabIcon name="history" size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: '차량',
          tabBarIcon: ({ color }) => <TabIcon name="vehicle" size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="check"
        options={{
          title: '점검',
          tabBarIcon: ({ color }) => <TabIcon name="inspect" size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '위치',
          href: role === 'commander' ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="location" size={26} color={color} />,
        }}
      />
    </Tabs>
  );
}
