import { Platform } from 'react-native';

let activeNotificationId: string | null = null;

async function loadNotifications() {
  if (Platform.OS === 'web') {
    return null;
  }

  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

export async function showTripRunningNotification(vehicleNumber: string, route: string): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return;
  }

  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('trip-running', {
      name: '운행 상태',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  if (activeNotificationId) {
    await Notifications.dismissNotificationAsync(activeNotificationId);
    activeNotificationId = null;
  }

  activeNotificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: '운행 중',
      body: `${vehicleNumber} · ${route}`,
      sticky: true,
      autoDismiss: false,
    },
    trigger: null,
  });
}

export async function clearTripRunningNotification(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications || !activeNotificationId) {
    return;
  }

  await Notifications.dismissNotificationAsync(activeNotificationId);
  activeNotificationId = null;
}
