import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VehicleSummary } from '@/lib/readonly-data';

type VehicleDropdownProps = {
  vehicles: VehicleSummary[];
  selectedVehicleId: string | null;
  onSelect: (vehicleId: string | null) => void;
  includeAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  compact?: boolean;
  displayLabel?: string;
  mutedDisplay?: boolean;
};

export function VehicleDropdown({
  vehicles,
  selectedVehicleId,
  onSelect,
  includeAll = false,
  allLabel = '전체',
  placeholder = '차량 선택',
  compact = false,
  displayLabel,
  mutedDisplay = false,
}: VehicleDropdownProps) {
  const [open, setOpen] = useState(false);
  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [selectedVehicleId, vehicles]
  );
  const label = displayLabel ?? selectedVehicle?.vehicleNumber ?? (includeAll && selectedVehicleId === null ? allLabel : placeholder);

  function select(vehicleId: string | null) {
    onSelect(vehicleId);
    setOpen(false);
  }

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <Pressable style={[styles.control, compact && styles.controlCompact]} onPress={() => setOpen((current) => !current)}>
        <Text style={[styles.value, mutedDisplay && styles.valueMuted]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </Pressable>

      {open ? (
        <View style={[styles.menu, compact && styles.menuCompact]}>
          {includeAll ? (
            <Pressable
              style={[styles.option, selectedVehicleId === null && styles.optionActive]}
              onPress={() => select(null)}>
              <Text style={[styles.optionText, selectedVehicleId === null && styles.optionTextActive]}>{allLabel}</Text>
            </Pressable>
          ) : null}
          {vehicles.map((vehicle) => (
            <Pressable
              key={vehicle.id}
              style={[styles.option, selectedVehicleId === vehicle.id && styles.optionActive]}
              onPress={() => select(vehicle.id)}>
              <Text style={[styles.optionText, selectedVehicleId === vehicle.id && styles.optionTextActive]}>
                {vehicle.vehicleNumber}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  wrapCompact: { marginTop: 0 },
  control: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlCompact: { minHeight: 42, borderRadius: 13 },
  value: { color: '#0F172A', fontSize: 15, fontWeight: '900', flex: 1 },
  valueMuted: { color: '#9AA8C7' },
  chevron: { color: '#64748B', fontSize: 12, fontWeight: '900' },
  menu: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  menuCompact: { marginTop: 6 },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  optionActive: { backgroundColor: '#EFF6FF' },
  optionText: { color: '#334155', fontSize: 14, fontWeight: '800' },
  optionTextActive: { color: '#2563EB' },
});
