import { Text, type TextStyle } from 'react-native';

export function IconSymbol({ name, color, size = 24 }: { name: string; color: string; size?: number; weight?: string; style?: TextStyle }) {
  const glyph = name.toLowerCase().includes('car') ? '차' : name.toLowerCase().includes('map') ? '위' : '•';
  return <Text style={{ color, fontSize: size, fontWeight: '900' }}>{glyph}</Text>;
}
