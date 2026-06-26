import AsyncStorage from '@react-native-async-storage/async-storage';

export type QueuedGpsPoint = {
  tripId: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  recordedAt: string;
};

const QUEUE_KEY = '@gps_queue';
const MAX_QUEUE_SIZE = 200;

export async function enqueueGpsPoint(point: QueuedGpsPoint): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: QueuedGpsPoint[] = raw ? JSON.parse(raw) : [];
    queue.push(point);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
  } catch {
    // Storage error — silently skip
  }
}

export async function dequeueAllGpsPoints(): Promise<QueuedGpsPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const queue: QueuedGpsPoint[] = JSON.parse(raw);
    await AsyncStorage.removeItem(QUEUE_KEY);
    return queue;
  } catch {
    return [];
  }
}

export async function getGpsQueueSize(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return 0;
    return (JSON.parse(raw) as QueuedGpsPoint[]).length;
  } catch {
    return 0;
  }
}
