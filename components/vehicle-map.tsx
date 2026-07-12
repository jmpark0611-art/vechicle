import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
  html: string;
  style?: object;
  onMapTap?: (lat: number, lng: number) => void;
}

export function VehicleMap({ html, style, onMapTap }: Props) {
  const onMapTapRef = useRef(onMapTap);
  onMapTapRef.current = onMapTap;

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'mapTap' && onMapTapRef.current) {
          onMapTapRef.current(msg.lat, msg.lng);
        }
      } catch {
        // 무시
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <View style={[styles.container, style]}>
      {React.createElement('iframe', {
        srcDoc: html,
        style: { width: '100%', height: '100%', border: 'none' },
        sandbox: 'allow-scripts allow-same-origin',
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
