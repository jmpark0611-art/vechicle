import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

type Props = {
  html: string;
  style?: StyleProp<ViewStyle>;
  onMapTap?: (lat: number, lng: number) => void;
  onMapCenter?: (lat: number, lng: number) => void;
};

export function VehicleMap({ html, style, onMapTap, onMapCenter }: Props) {
  function handleMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; lat: number; lng: number };
      if (msg.type === 'mapTap' && onMapTap) {
        onMapTap(msg.lat, msg.lng);
      }
      if (msg.type === 'mapCenter' && onMapCenter) {
        onMapCenter(msg.lat, msg.lng);
      }
    } catch { /* ignore malformed messages */ }
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        onMessage={handleMessage}
        scrollEnabled={false}
        bounces={false}
        originWhitelist={['*']}
        javaScriptEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 16 },
  webview: { flex: 1 },
});
