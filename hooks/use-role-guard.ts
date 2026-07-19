import { router } from 'expo-router';
import { useEffect } from 'react';

import { getStoredRole, type AppRole } from '@/lib/role';

const FALLBACK_BY_ROLE: Record<AppRole, string> = {
  driver: '/(tabs)',
  commander: '/(tabs)/explore',
  admin: '/(tabs)/map',
};

export function useRoleGuard(allowedRoles: AppRole[]) {
  useEffect(() => {
    let alive = true;
    void getStoredRole().then((role) => {
      if (!alive) return;
      if (!role) {
        router.replace('/role-select');
        return;
      }
      if (!allowedRoles.includes(role)) {
        router.replace(FALLBACK_BY_ROLE[role]);
      }
    });

    return () => {
      alive = false;
    };
  }, [allowedRoles]);
}
