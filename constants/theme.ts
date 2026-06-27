import { Platform } from 'react-native';

const tintColorLight = '#A8FF5F';
const tintColorDark = '#A8FF5F';

export const Colors = {
  light: {
    text: '#F8FAFC',
    background: '#101112',
    tint: tintColorLight,
    icon: '#9AA3AD',
    tabIconDefault: '#6F777F',
    tabIconSelected: tintColorLight,
    card: '#17191B',
    border: '#30343A',
    muted: '#B7BDC5',
    success: '#A8FF5F',
    warning: '#FFD166',
    danger: '#FF8A8A',
  },
  dark: {
    text: '#F8FAFC',
    background: '#101112',
    tint: tintColorDark,
    icon: '#9AA3AD',
    tabIconDefault: '#6F777F',
    tabIconSelected: tintColorDark,
    card: '#17191B',
    border: '#30343A',
    muted: '#B7BDC5',
    success: '#A8FF5F',
    warning: '#FFD166',
    danger: '#FF8A8A',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
