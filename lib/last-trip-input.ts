import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'last_trip_input_v1';
const RECENT_PLACES_KEY = 'recent_end_places_v1';
const MAX_RECENT_PLACES = 6;

export type LastTripInput = {
  operatorRank: string;
  operatorName: string;
  userRank: string;
  userName: string;
  sameUser: boolean;
  startPlace: string;
};

export async function loadLastTripInput(): Promise<LastTripInput | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastTripInput;
  } catch {
    return null;
  }
}

export async function saveLastTripInput(input: LastTripInput): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(input));
  } catch {
    // Non-critical; failure to cache does not break trip start.
  }
}

export async function loadRecentEndPlaces(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_PLACES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function saveRecentEndPlace(endPlace: string): Promise<void> {
  if (!endPlace.trim()) return;
  try {
    const current = await loadRecentEndPlaces();
    const updated = [endPlace, ...current.filter((p) => p !== endPlace)].slice(0, MAX_RECENT_PLACES);
    await AsyncStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(updated));
  } catch {
    // Non-critical.
  }
}
