import { Pressable } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

export function HapticTab(props: BottomTabBarButtonProps) {
  const { children, onPress, onLongPress, accessibilityState } = props;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityState={accessibilityState}>
      {children}
    </Pressable>
  );
}
