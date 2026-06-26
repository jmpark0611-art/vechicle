import { Platform } from 'react-native';

const tintColorLight = '#1565C0';
const tintColorDark = '#8AB4F8';

export const Colors = {
  light: {
    text: '#101828',
    background: '#F6F8FB',
    tint: tintColorLight,
    icon: '#667085',
    tabIconDefault: '#667085',
    tabIconSelected: tintColorLight,
    card: '#FFFFFF',
    border: '#E3E8EF',
    muted: '#667085',
    success: '#087443',
    warning: '#8C5A00',
    danger: '#A8071A',
  },
  dark: {
    text: '#F8FAFC',
    background: '#111827',
    tint: tintColorDark,
    icon: '#CBD5E1',
    tabIconDefault: '#CBD5E1',
    tabIconSelected: tintColorDark,
    card: '#1F2937',
    border: '#334155',
    muted: '#CBD5E1',
    success: '#6EE7B7',
    warning: '#FCD34D',
    danger: '#FCA5A5',
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
