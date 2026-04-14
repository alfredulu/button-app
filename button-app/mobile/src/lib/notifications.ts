import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "@/lib/api/api";

let _foregroundHandlerSet = false;

/** Call once at startup so foreground notifications can display. */
export function setupNotificationForegroundHandler(): void {
  if (_foregroundHandlerSet) return;
  _foregroundHandlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type ReminderSettings = {
  enabled: boolean;
  minutesBefore: 5 | 10 | 30;
};

const STORAGE_KEY = "reminders:settings:v1";

const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: false,
  minutesBefore: 10,
};

type CalendarEvent = {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  description: string;
};

let _channelReady = false;

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || _channelReady) return;
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  _channelReady = true;
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    const enabled = Boolean(parsed.enabled);
    const minutesBefore =
      parsed.minutesBefore === 5 || parsed.minutesBefore === 10 || parsed.minutesBefore === 30
        ? parsed.minutesBefore
        : DEFAULT_SETTINGS.minutesBefore;
    return { enabled, minutesBefore };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setReminderSettings(next: ReminderSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function ensureReminderPermissions(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function parseEventStart(ev: CalendarEvent): Date | null {
  try {
    const d = new Date(`${ev.date}T${ev.time}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Registers the Expo push token with the backend (requires notification permission).
 * Safe to call when permission is denied — no-op.
 */
export async function syncExpoPushTokenToBackend(): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    await ensureAndroidChannel();

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResult.data;
    if (!token) return;

    await api.patch("/api/user/settings", { expoPushToken: token });
  } catch (e) {
    console.warn("[notifications] syncExpoPushTokenToBackend:", e);
  }
}

export async function scheduleRemindersForAddedEvents(events: CalendarEvent[]): Promise<void> {
  const settings = await getReminderSettings();
  if (!settings.enabled) return;

  const ok = await ensureReminderPermissions();
  if (!ok) return;

  await ensureAndroidChannel();

  const now = Date.now();
  const leadMs = settings.minutesBefore * 60_000;

  for (const ev of events) {
    const start = parseEventStart(ev);
    if (!start) continue;

    const triggerAt = start.getTime() - leadMs;
    if (triggerAt <= now + 5_000) continue; // skip immediate/past triggers

    await Notifications.scheduleNotificationAsync({
      content: {
        title: ev.title,
        body: `Starts in ${settings.minutesBefore} minutes`,
        data: { kind: "calendar-reminder" },
      },
      trigger: { type: "date", date: new Date(triggerAt) },
    });
  }
}

