import { createElement, useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  html: string;
  style?: StyleProp<ViewStyle>;
  onMapTap?: (lat: number, lng: number) => void;
};

export function VehicleMap({ html, style, onMapTap }: Props) {
  useEffect(() => {
    if (!onMapTap) return;
    function handleMsg(e: MessageEvent) {
      try {
        const msg = JSON.parse(String(e.data)) as { type: string; lat: number; lng: number };
        if (msg.type === 'mapTap') onMapTap!(msg.lat, msg.lng);
      } catch { /* ignore */ }
    }
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [onMapTap]);

  return createElement(
    View,
    { style: [{ overflow: 'hidden', borderRadius: 16 }, style] },
    createElement('iframe', {
      srcDoc: html,
      style: { width: '100%', height: '100%', border: 'none', display: 'block' },
      sandbox: 'allow-scripts allow-same-origin',
    } as React.IframeHTMLAttributes<HTMLIFrameElement>)
  );
}
