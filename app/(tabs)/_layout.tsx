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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getStoredRole().then((r) => {
      setRole(r);
      setReady(true);
    });
  }, []);

  // 탭 가시성 — role 확정 전까지 모든 탭 숨겨서 깜빡임 방지
  const isDriver = ready && role === 'driver';
  const isCommander = ready && role === 'commander';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: NAV.accent,
        tabBarInactiveTintColor: NAV.textMuted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          position: 'absolute',
          bottom: insets.bottom + 10,
          left: 14,
          right: 14,
          borderRadius: 26,
          height: 66,
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#E2E8F0',
          elevation: 12,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 16,
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

      {/* ── 운행 탭 — 운행 모드 전용 ── */}
      <Tabs.Screen
        name="index"
        options={{
          title: '운행',
          href: isDriver ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="trip" size={26} color={color} />,
        }}
      />

      {/* ── 기록 탭 — 수송부 모드 전용 ── */}
      <Tabs.Screen
        name="explore"
        options={{
          title: '기록',
          href: isCommander ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="history" size={26} color={color} />,
        }}
      />

      {/* ── 차량진단 탭 — 수송부 모드 전용 ── */}
      <Tabs.Screen
        name="vehicles"
        options={{
          title: '차량진단',
          href: isCommander ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="vehicle" size={26} color={color} />,
        }}
      />

      {/* ── 위치 탭 — 수송부 모드 전용 ── */}
      <Tabs.Screen
        name="map"
        options={{
          title: '위치',
          href: isCommander ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="location" size={26} color={color} />,
        }}
      />

      {/* ── 점검 탭 — 테스트 기간 동안 비노출 ── */}
      <Tabs.Screen
        name="check"
        options={{
          title: '점검',
          href: null,
          tabBarIcon: ({ color }) => <TabIcon name="inspect" size={26} color={color} />,
        }}
      />
    </Tabs>
  );
}
