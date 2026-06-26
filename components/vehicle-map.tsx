import React from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
  html: string;
  style?: object;
}

export function VehicleMap({ html, style }: Props) {
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
