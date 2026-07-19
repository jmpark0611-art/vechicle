import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'last_trip_input_v1';

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
