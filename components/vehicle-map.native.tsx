import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

type Props = {
  html: string;
  style?: StyleProp<ViewStyle>;
  onMapTap?: (lat: number, lng: number) => void;
  onMapCenter?: (lat: number, lng: number) => void;
  onPolygonChange?: (points: { latitude: number; longitude: number }[]) => void;
};

export function VehicleMap({ html, style, onMapTap, onMapCenter, onPolygonChange }: Props) {
  function handleMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        lat?: number;
        lng?: number;
        points?: { latitude: number; longitude: number }[];
      };
      if (msg.type === 'mapTap' && onMapTap) {
        if (typeof msg.lat === 'number' && typeof msg.lng === 'number') onMapTap(msg.lat, msg.lng);
      }
      if (msg.type === 'mapCenter' && onMapCenter) {
        if (typeof msg.lat === 'number' && typeof msg.lng === 'number') onMapCenter(msg.lat, msg.lng);
      }
      if (msg.type === 'polygonChange' && onPolygonChange && Array.isArray(msg.points)) {
        onPolygonChange(msg.points);
      }
    } catch { /* ignore malformed messages */ }
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        onMessage={handleMessage}
        scrollEnabled
        nestedScrollEnabled
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
