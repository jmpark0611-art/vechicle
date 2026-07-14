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
};

export function VehicleDropdown({
  vehicles,
  selectedVehicleId,
  onSelect,
  includeAll = false,
  allLabel = '전체 차량',
  placeholder = '차량 선택',
}: VehicleDropdownProps) {
  const [open, setOpen] = useState(false);
  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [selectedVehicleId, vehicles]
  );
  const label = selectedVehicle?.vehicleNumber ?? (includeAll && selectedVehicleId === null ? allLabel : placeholder);

  function select(vehicleId: string | null) {
    onSelect(vehicleId);
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.control} onPress={() => setOpen((current) => !current)}>
        <View style={styles.iconBox}>
          <Text style={styles.icon}>▣</Text>
        </View>
        <View style={styles.textBox}>
          <Text style={styles.label}>차량</Text>
          <Text style={styles.value} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.menu}>
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
  wrap: { marginTop: 12 },
  control: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: '#2563EB', fontSize: 16, fontWeight: '900' },
  textBox: { flex: 1, minWidth: 0 },
  label: { color: '#64748B', fontSize: 11, fontWeight: '800', marginBottom: 2 },
  value: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  chevron: { color: '#64748B', fontSize: 18, fontWeight: '900' },
  menu: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  optionActive: { backgroundColor: '#EFF6FF' },
  optionText: { color: '#334155', fontSize: 14, fontWeight: '800' },
  optionTextActive: { color: '#2563EB' },
});
