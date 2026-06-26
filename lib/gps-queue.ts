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

function parseQueue(raw: string | null): QueuedGpsPoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function enqueueGpsPoint(point: QueuedGpsPoint): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = parseQueue(raw);
    queue.push(point);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
    return true;
  } catch {
    return false;
  }
}

export async function dequeueAllGpsPoints(): Promise<QueuedGpsPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = parseQueue(raw);
    await AsyncStorage.removeItem(QUEUE_KEY);
    return queue;
  } catch {
    return [];
  }
}

export async function getGpsQueueSize(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return parseQueue(raw).length;
  } catch {
    return 0;
  }
}
