import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import SiriSheet from "@/components/SiriSheet";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { Mic, Check, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import * as Calendar from "expo-calendar";
import { useSession } from "@/lib/auth/use-session";
import { supabase } from "@/lib/auth/supabase";
import { api } from "@/lib/api/api";
import {
  explainBackendConnectionFailure,
  getBackendBaseUrl,
} from "@/lib/api/backend-url";
import { scheduleRemindersForAddedEvents } from "@/lib/notifications";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type CalendarEvent = {
  title: string;
  date: string;
  time: string;
  description: string;
};

function PulseRing({
  delay,
  isRecording,
}: {
  delay: number;
  isRecording: boolean;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    const duration = isRecording ? 800 : 2200;
    const timer = setTimeout(() => {
      progress.value = withRepeat(
        withTiming(1, { duration, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [isRecording]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.75]) }],
    opacity: interpolate(progress.value, [0, 0.3, 1], [0.18, 0.12, 0]),
  }));

  const ringColor = isRecording ? "#C0392B" : "#1a1a18";

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        { borderColor: ringColor },
        animStyle,
      ]}
    />
  );
}

type PlanningProfile = {
  currentStreak: number;
  longestStreak: number;
};

export default function HomeScreen() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [addedToCalendar, setAddedToCalendar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [sheetVisible, setSheetVisible] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bottom sheet + button
  const sheetY = useSharedValue(500);
  const buttonScale = useSharedValue(1);

  const { data: planning } = useQuery<PlanningProfile>({
    queryKey: ["planning-profile"],
    queryFn: async () => {
      const res = await api.get<PlanningProfile>("/api/user/planning-profile");
      return res ?? { currentStreak: 0, longestStreak: 0 };
    },
    enabled: Boolean(session?.user),
  });

  // Backdrop opacity
  const backdropOpacity = useSharedValue(0);

  // Entrance animations
  const headerAnim = useSharedValue(0);
  const headerY = useSharedValue(-8);
  const promptAnim = useSharedValue(0);
  const promptY = useSharedValue(12);
  const buttonAreaAnim = useSharedValue(0);
  const buttonAreaY = useSharedValue(12);

  // Error text animation
  const errorAnim = useSharedValue(0);
  const errorY = useSharedValue(8);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerAnim.value,
    transform: [{ translateY: headerY.value }],
  }));

  const promptAnimStyle = useAnimatedStyle(() => ({
    opacity: promptAnim.value,
    transform: [{ translateY: promptY.value }],
  }));

  const buttonAreaAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonAreaAnim.value,
    transform: [{ translateY: buttonAreaY.value }],
  }));

  const errorAnimStyle = useAnimatedStyle(() => ({
    opacity: errorAnim.value,
    transform: [{ translateY: errorY.value }],
  }));

  const enterConfig = { duration: 350, easing: Easing.out(Easing.cubic) };

  // Trigger entrance animations on mount
  useEffect(() => {
    headerAnim.value = withTiming(1, enterConfig);
    headerY.value = withTiming(0, enterConfig);

    const t1 = setTimeout(() => {
      promptAnim.value = withTiming(1, enterConfig);
      promptY.value = withTiming(0, enterConfig);
    }, 80);

    const t2 = setTimeout(() => {
      buttonAreaAnim.value = withTiming(1, enterConfig);
      buttonAreaY.value = withTiming(0, enterConfig);
    }, 160);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Animate error text in/out
  useEffect(() => {
    if (error) {
      errorY.value = 8;
      errorAnim.value = 0;
      errorAnim.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) });
      errorY.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.cubic) });
    } else {
      errorAnim.value = withTiming(0, { duration: 150 });
    }
  }, [error]);

  useEffect(() => {
    Audio.requestPermissionsAsync();
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      setError(null);
      setEvents([]);
      setAddedToCalendar(false);
      sheetY.value = 500;
      backdropOpacity.value = withTiming(0, { duration: 200 });

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      startTimeRef.current = Date.now();
      setRecordingDuration(0);

      durationTimerRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsRecording(true);
      buttonScale.value = withSpring(0.94, { damping: 18, stiffness: 220 });
    } catch {
      setError("Could not access microphone.");
    }
  };

  const stopRecording = async () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    setIsRecording(false);
    buttonScale.value = withSpring(1, { damping: 18, stiffness: 220 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const duration = (Date.now() - startTimeRef.current) / 1000;
    const recording = recordingRef.current;
    recordingRef.current = null;

    if (!recording) return;

    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    if (duration < 1) {
      setError("Hold longer and speak your plans.");
      return;
    }

    const uri = recording.getURI();
    if (!uri) return;

    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append("audio", {
        uri,
        type: "audio/m4a",
        name: "recording.m4a",
      } as unknown as Blob);
      formData.append("durationSecs", String(Math.max(0, Math.floor(duration))));
      formData.append(
        "timeZone",
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
      );

      const { data: { session } } = await supabase.auth.getSession();
      const backend = getBackendBaseUrl();
      if (!backend) {
        setError(
          "EXPO_PUBLIC_BACKEND_URL is missing. Add your backend URL to mobile/.env (LAN IP:3000 on a real phone)."
        );
        return;
      }
      const response = await fetch(`${backend}/api/transcribe`, {
          method: "POST",
          body: formData,
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (data?.error?.code === "PLAN_LIMIT") {
          setError(data.error.message);
        } else if (data?.error?.code === "NO_API_KEY") {
          setError("AI service not configured. Add your OPENAI_API_KEY.");
        } else {
          setError(data?.error?.message || "Could not process your recording.");
        }
        return;
      }

      const parsed: CalendarEvent[] = data?.data?.events ?? [];
      if (parsed.length === 0) {
        setError("No events found. Try speaking more clearly.");
        return;
      }

      setEvents(parsed);
      sheetY.value = withSpring(0, { damping: 20, stiffness: 120 });
      backdropOpacity.value = withTiming(0.15, { duration: 300 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError(explainBackendConnectionFailure());
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddToCalendar = async () => {
    try {
      // Prefer Google Calendar if connected.
      try {
        const status = await api.get<{ connected: boolean }>("/api/google-calendar/status");
        if (status?.connected) {
          const timeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
          await api.post("/api/calendar/add", {
            events: events.map((e) => ({
              title: e.title,
              date: e.date,
              time: e.time,
              description: e.description,
              durationMins: 60,
            })),
            timeZone,
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setAddedToCalendar(true);
          queryClient.invalidateQueries({ queryKey: ["planning-profile"] });
          scheduleRemindersForAddedEvents(events).catch(() => {});
          return;
        }
      } catch {
        // Fall back to device calendar on any Google errors.
      }

      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please grant calendar access in Settings.");
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writable = calendars.find((c) => c.allowsModifications);
      if (!writable) {
        Alert.alert("No calendar found", "Could not find a writable calendar.");
        return;
      }

      for (const ev of events) {
        const startDate = new Date(`${ev.date}T${ev.time}:00`);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
        await Calendar.createEventAsync(writable.id, {
          title: ev.title,
          startDate,
          endDate,
          notes: ev.description,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAddedToCalendar(true);
      scheduleRemindersForAddedEvents(events).catch(() => {});
    } catch {
      Alert.alert("Error", "Could not add events to calendar.");
    }
  };

  const dismissSheet = () => {
    sheetY.value = withTiming(500, { duration: 300, easing: Easing.out(Easing.cubic) });
    backdropOpacity.value = withTiming(0, { duration: 300 });
    setTimeout(() => {
      setEvents([]);
      setAddedToCalendar(false);
    }, 320);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatEventDateTime = (date: string, time: string) => {
    try {
      const d = new Date(`${date}T${time}:00`);
      return d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch {
      return `${date} at ${time}`;
    }
  };

  const user = session?.user;
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "?";

  const buttonColor = isRecording ? "#C0392B" : "#1a1a18";

  return (
    <SafeAreaView style={styles.container}>
      {/* Full-screen tap to open SiriSheet — behind all content */}
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onPress={() => setSheetVisible(true)}
        testID="open-siri-sheet"
      />

      {/* Backdrop dim when events sheet is open */}
      {events.length > 0 ? (
        <Animated.View
          style={[styles.backdrop, backdropStyle]}
          pointerEvents="none"
        />
      ) : null}

      {/* Header */}
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View>
          <Text style={styles.headerLogo}>Button</Text>
          {session?.user ? (
            <Text style={styles.streakHint}>
              🔥 {planning?.currentStreak ?? 0} day streak
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.avatar}
          onPress={() => router.push("/settings")}
          testID="settings-button"
        >
          <Text style={styles.avatarText}>{initials}</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Main content — zIndex:2 so it's above the background pressable */}
      <View style={[styles.main, { zIndex: 2 }]}>
        <Animated.Text style={[styles.promptText, promptAnimStyle]}>
          {isRecording
            ? "Listening..."
            : isProcessing
            ? "Adding to your calendar..."
            : "What's on your schedule?"}
        </Animated.Text>

        {/* Button with pulse rings */}
        <Animated.View style={[styles.buttonArea, buttonAreaAnimStyle]}>
          <PulseRing delay={0} isRecording={isRecording} />
          <PulseRing delay={500} isRecording={isRecording} />
          <PulseRing delay={1000} isRecording={isRecording} />

          <Pressable
            onPressIn={startRecording}
            onPressOut={stopRecording}
            onPress={() => {
              if (!isRecording && !isProcessing) {
                setSheetVisible(true);
              }
            }}
            disabled={isProcessing}
            testID="record-button"
          >
            <Animated.View style={[styles.mainButton, { backgroundColor: buttonColor }, btnStyle]}>
              {isProcessing ? (
                <ActivityIndicator color="#ffffff" size="large" />
              ) : (
                <Mic size={36} color="#ffffff" strokeWidth={1.5} />
              )}
            </Animated.View>
          </Pressable>
        </Animated.View>

        <Animated.Text style={[styles.holdText, buttonAreaAnimStyle]}>
          {isRecording ? formatDuration(recordingDuration) : "HOLD TO SPEAK"}
        </Animated.Text>

        {error ? (
          <Animated.View style={[styles.errorWrapper, errorAnimStyle]}>
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        ) : null}
      </View>

      {/* Events bottom sheet */}
      {events.length > 0 ? (
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            Found {events.length} event{events.length !== 1 ? "s" : ""}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.eventList}>
            {events.map((ev, i) => (
              <View key={i} style={styles.eventCard}>
                <Text style={styles.eventTitle}>{ev.title}</Text>
                <Text style={styles.eventDateTime}>
                  {formatEventDateTime(ev.date, ev.time)}
                </Text>
                {ev.description ? (
                  <Text style={styles.eventDesc}>{ev.description}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>

          {addedToCalendar ? (
            <View style={styles.successRow}>
              <Check size={18} color="#2ecc71" strokeWidth={2.5} />
              <Text style={styles.successText}>Added to calendar!</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddToCalendar}
              activeOpacity={0.85}
              testID="add-to-calendar-button"
            >
              <Text style={styles.addButtonText}>Add to Calendar</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={dismissSheet}
            testID="dismiss-button"
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      {/* Siri-style sheet */}
      <SiriSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000000",
    zIndex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    zIndex: 2,
  },
  headerLogo: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 24,
    color: "#1a1a18",
  },
  streakHint: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    color: "#9a9a95",
    marginTop: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1a1a18",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: "#ffffff",
  },
  main: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    zIndex: 2,
  },
  promptText: {
    fontFamily: "DMSans_300Light",
    fontSize: 16,
    color: "#9a9a95",
    letterSpacing: 0.3,
  },
  buttonArea: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
  },
  mainButton: {
    width: 130,
    height: 130,
    borderRadius: 65,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  holdText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 10,
    color: "#9a9a95",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  errorWrapper: {
    paddingHorizontal: 32,
  },
  errorText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: "#C0392B",
    textAlign: "center",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 12,
    maxHeight: "70%",
    zIndex: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e0e0dc",
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: "PlayfairDisplay_400Regular",
    fontSize: 20,
    color: "#1a1a18",
    marginBottom: 16,
  },
  eventList: { maxHeight: 260 },
  eventCard: {
    backgroundColor: "#f9f9f7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  eventTitle: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: "#1a1a18",
    marginBottom: 4,
  },
  eventDateTime: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: "#9a9a95",
  },
  eventDesc: {
    fontFamily: "DMSans_300Light",
    fontSize: 12,
    color: "#9a9a95",
    marginTop: 4,
  },
  addButton: {
    backgroundColor: "#1a1a18",
    borderRadius: 50,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  addButtonText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: "#ffffff",
  },
  successRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    height: 52,
  },
  successText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: "#2ecc71",
  },
  dismissBtn: { alignItems: "center", marginTop: 12 },
  dismissText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: "#9a9a95",
  },
});
