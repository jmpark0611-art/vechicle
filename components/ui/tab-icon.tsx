import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

const TAB_ICON_MAP = {
  trip: 'steering',
  history: 'clipboard-list-outline',
  vehicle: 'car-outline',
  inspect: 'radar',
  location: 'crosshairs-gps',
} as const;

type TabIconName = keyof typeof TAB_ICON_MAP;

export function TabIcon({ name, size = 26, color }: { name: TabIconName; size?: number; color: string }) {
  return <MaterialCommunityIcons name={TAB_ICON_MAP[name]} size={size} color={color} />;
}
