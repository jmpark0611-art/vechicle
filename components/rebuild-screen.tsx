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
}>;

export function RebuildScreen({ title, subtitle, roleLabel, metrics = [], actionLabel, onAction, onSettings, children }: RebuildScreenProps) {
  const insets = useSafeAreaInsets();
  const tabBarSpace = insets.bottom + 80;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: actionLabel ? 12 : tabBarSpace }]}
        showsVerticalScrollIndicator={false}>

        {/* 헤더 */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.headerRight}>
            {roleLabel ? (
              <View style={styles.rolePill}>
                <Text style={styles.rolePillText}>{roleLabel}</Text>
              </View>
            ) : null}
            {onSettings ? (
              <Pressable style={styles.settingsBtn} onPress={onSettings} hitSlop={12}>
                <Text style={styles.settingsBtnText}>⚙</Text>
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
      </ScrollView>

      {/* 고정 하단 버튼 */}
      {actionLabel ? (
        <View style={[styles.footer, { paddingBottom: tabBarSpace }]}>
          <Pressable style={styles.primaryBtn} onPress={onAction}>
            <Text style={styles.primaryBtnText}>{actionLabel}</Text>
          </Pressable>
        </View>
      ) : null}
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
  content: { paddingHorizontal: 18 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 12,
  },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#1A2340', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
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

  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFDFB',
    borderWidth: 1,
    borderColor: '#E2E8F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBtnText: { fontSize: 16 },

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

  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: '#F4F5FB',
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#5B7CFA',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8FA3FF',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});

export const rebuildStyles = styles;
