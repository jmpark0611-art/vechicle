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
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

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
  screen: { flex: 1, backgroundColor: '#F7F3FF' },
  content: { paddingHorizontal: 24 },
  title: { color: '#222B45', fontSize: 28, fontWeight: '900', letterSpacing: 0 },
  subtitle: { color: '#7180A3', fontSize: 14, fontWeight: '700', marginTop: 6, marginBottom: 16, lineHeight: 20 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, marginBottom: 16 },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFDFB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 68,
    shadowColor: '#A7B0D8',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  metricLabel: { color: '#7B86A8', fontSize: 11, fontWeight: '800', marginBottom: 6 },
  metricValue: { color: '#222B45', fontSize: 20, fontWeight: '900' },
  sectionCard: {
    backgroundColor: '#FFFDFB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EAF7',
    padding: 18,
    marginBottom: 12,
    shadowColor: '#A7B0D8',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionTitle: { color: '#222B45', fontSize: 15, fontWeight: '900' },
  sectionBody: { color: '#7180A3', fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 6 },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2FA',
    paddingTop: 10,
    marginTop: 10,
  },
  statusLabel: { color: '#7B86A8', fontSize: 12, fontWeight: '800' },
  statusValue: { color: '#222B45', fontSize: 13, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  loadingText: { color: '#7180A3', fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  primaryBtn: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#5B7CFA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#8FA3FF',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});

export const rebuildStyles = styles;
