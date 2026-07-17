import { router } from 'expo-router';
import { PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStoredRole, type AppRole } from '@/lib/role';

type Metric = {
  label: string;
  value: string;
};

type RebuildScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  roleLabel?: string;
  metrics?: Metric[];
  actionLabel?: string;
  onAction?: () => void;
  onSettings?: () => void;
}>;

export function RebuildScreen({ title, subtitle, roleLabel, metrics = [], actionLabel, onAction, onSettings, children }: RebuildScreenProps) {
  const insets = useSafeAreaInsets();
  const tabBarSpace = insets.bottom + 68;
  const [storedRole, setStoredRole] = useState<AppRole | null>(null);
  const resolvedRoleLabel = roleLabel ?? (storedRole === 'commander' ? '수송부' : storedRole === 'driver' ? '운전자' : undefined);
  const titleIcon = useMemo(() => {
    if (title === '운행') return '▶';
    if (title === '기록') return '☰';
    if (title === '진단') return '▣';
    if (title === '위치') return '⌖';
    if (title === '점검') return '✓';
    return '•';
  }, [title]);

  useEffect(() => {
    void getStoredRole().then(setStoredRole);
  }, []);

  function openModeSettings() {
    if (onSettings) onSettings();
    else router.push('/mode-settings' as never);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: tabBarSpace }]}
        showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.titleMark}>
              <Text style={styles.titleIcon}>{titleIcon}</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.headerRight}>
            {resolvedRoleLabel ? (
              <Pressable style={styles.rolePill} onPress={openModeSettings} hitSlop={10}>
                <Text style={styles.rolePillText}>{resolvedRoleLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {metrics.length > 0 ? (
          <View style={styles.metricGrid}>
            {metrics.map((metric) => (
              <View key={metric.label} style={styles.metricCard}>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                <Text style={styles.metricValue}>{metric.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {children}

        {actionLabel ? (
          <Pressable style={styles.primaryBtn} onPress={onAction}>
            <Text style={styles.primaryBtnText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function SectionCard({ title, body, children }: PropsWithChildren<{ title: string; body?: string }>) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {body ? <Text style={styles.sectionBody}>{body}</Text> : null}
      {children}
    </View>
  );
}

export function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusLine}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

export function LoadingCard({ label = '불러오는 중' }: { label?: string }) {
  return (
    <View style={styles.sectionCard}>
      <ActivityIndicator color="#5B7CFA" />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F5FB' },
  content: { flexGrow: 1, paddingHorizontal: 18 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
    paddingHorizontal: 2,
    paddingVertical: 4,
    marginBottom: 8,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleMark: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFDFB',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 5,
    shadowColor: '#B0B8D8',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  titleIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EDF2FF',
    color: '#4F6AE6',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 24,
  },
  title: { color: '#24304F', fontSize: 13, fontWeight: '900', letterSpacing: 0 },
  subtitle: { color: '#7180A3', fontSize: 12, fontWeight: '700', marginTop: 3 },

  rolePill: {
    backgroundColor: '#EEF2FF',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  rolePillText: { color: '#4F6AE6', fontSize: 11, fontWeight: '900' },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFDFB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  metricLabel: { color: '#7B86A8', fontSize: 11, fontWeight: '800', marginBottom: 4 },
  metricValue: { color: '#222B45', fontSize: 20, fontWeight: '900' },

  sectionCard: {
    backgroundColor: '#FFFDFB',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 16,
    marginBottom: 10,
    shadowColor: '#B0B8D8',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionTitle: { color: '#24304F', fontSize: 14, fontWeight: '900', marginBottom: 2 },
  sectionBody: { color: '#7180A3', fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 4 },

  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2FA',
    paddingTop: 9,
    marginTop: 9,
  },
  statusLabel: { color: '#7B86A8', fontSize: 12, fontWeight: '800' },
  statusValue: { color: '#222B45', fontSize: 13, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  loadingText: { color: '#7180A3', fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 12 },

  primaryBtn: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#4F6AE6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8FA3FF',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});

export const rebuildStyles = styles;
