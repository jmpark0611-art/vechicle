// expo-notifications removed: caused Android native startup crash before JS runs.
// Restore once a stable alternative (e.g. Headless JS or a lighter library) is tested.

export async function showTripRunningNotification(_vehicleNumber: string, _route: string): Promise<void> {}

export async function clearTripRunningNotification(): Promise<void> {}
