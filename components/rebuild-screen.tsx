import { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  bottomSpace?: 'tab' | 'compact' | 'none';
}>;

export function RebuildScreen({ title, subtitle, metrics = [], actionLabel, onAction, children, bottomSpace = 'tab' }: RebuildScreenProps) {
  const insets = useSafeAreaInsets();
  const footerSpace =
    bottomSpace === 'none' ? insets.bottom + 10 : bottomSpace === 'compact' ? insets.bottom + 54 : insets.bottom + 68;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: footerSpace }]}
        showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
      <ActivityIndicator color="#2563EB" />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F0F4FB' },
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
  title: { color: '#0F172A', fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { color: '#64748B', fontSize: 12, fontWeight: '500', marginTop: 3 },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  metricLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  metricValue: { color: '#0F172A', fontSize: 20, fontWeight: '700' },

  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F8',
    padding: 16,
    marginBottom: 10,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionTitle: { color: '#0F172A', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  sectionBody: { color: '#64748B', fontSize: 13, fontWeight: '400', lineHeight: 19, marginTop: 4 },

  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5FB',
    paddingTop: 9,
    marginTop: 9,
  },
  statusLabel: { color: '#64748B', fontSize: 12, fontWeight: '500' },
  statusValue: { color: '#0F172A', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  loadingText: { color: '#64748B', fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 12 },

  primaryBtn: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

export const rebuildStyles = styles;
