import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  html: string;
  style?: StyleProp<ViewStyle>;
}

export function VehicleMap({ html, style }: Props) {
  return (
    <WebView
      source={{ html }}
      style={[styles.map, style]}
      scrollEnabled={false}
      javaScriptEnabled
      originWhitelist={['*']}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
