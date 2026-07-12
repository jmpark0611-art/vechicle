import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

interface Props {
  html: string;
  style?: object;
  onMapTap?: (lat: number, lng: number) => void;
}

export function VehicleMap({ html, style, onMapTap }: Props) {
  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'mapTap' && onMapTap) {
        onMapTap(msg.lat, msg.lng);
      }
    } catch {
      // 무시
    }
  };

  return (
    <WebView
      source={{ html }}
      style={[styles.map, style]}
      scrollEnabled={false}
      javaScriptEnabled
      originWhitelist={['*']}
      onMessage={handleMessage}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
