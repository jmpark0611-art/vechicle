import { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Metric = {
  label: string;
  value: string;
};

type RebuildScreenProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  metrics?: Metric[];
  actionLabel?: string;
  onAction?: () => void;
}>;

export function RebuildScreen({ title, subtitle, metrics = [], actionLabel, onAction, children }: RebuildScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 96 }]}
      showsVerticalScrollIndicator={false}>
      <Text style={styles.date}>2026년 7월 13일</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {metrics.length > 0 && (
        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>{metric.value}</Text>
            </View>
          ))}
        </View>
      )}

      {children}

      {actionLabel && (
        <Pressable style={styles.primaryBtn} onPress={onAction}>
          <Text style={styles.primaryBtnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export function SectionCard({ title, body, children }: PropsWithChildren<{ title: string; body: string }>) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
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
      <ActivityIndicator color="#2563EB" />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { paddingHorizontal: 24 },
  date: { color: '#64748B', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  title: { color: '#0F172A', fontSize: 28, fontWeight: '900', letterSpacing: 0 },
  subtitle: { color: '#64748B', fontSize: 14, fontWeight: '700', marginTop: 8, marginBottom: 20, lineHeight: 21 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    minHeight: 92,
  },
  metricLabel: { color: '#64748B', fontSize: 12, fontWeight: '800', marginBottom: 8 },
  metricValue: { color: '#0F172A', fontSize: 22, fontWeight: '900' },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 14,
  },
  sectionTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900', marginBottom: 8 },
  sectionBody: { color: '#64748B', fontSize: 14, fontWeight: '600', lineHeight: 21 },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
    marginTop: 12,
  },
  statusLabel: { color: '#64748B', fontSize: 12, fontWeight: '800' },
  statusValue: { color: '#0F172A', fontSize: 13, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  loadingText: { color: '#64748B', fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  primaryBtn: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#2563EB',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});

export const rebuildStyles = styles;
