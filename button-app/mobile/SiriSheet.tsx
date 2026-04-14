import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { Mic, Check } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import * as Calendar from "expo-calendar";
import { supabase } from "@/lib/auth/supabase";
import { api } from "@/lib/api/api";
import {
  explainBackendConnectionFailure,
  getBackendBaseUrl,
} from "@/lib/api/backend-url";
import { scheduleRemindersForAddedEvents } from "@/lib/notifications";
import { useQueryClient } from "@tanstack/react-query";

type SheetState = "idle" | "recording" | "processing" | "results";

type CalendarEvent = {
  title: string;
  date: string;
  time: string;
  description: string;
};

export interface SiriSheetProps {
  visible: boolean;
  onClose: () => void;
}

// ─── PulseRing ────────────────────────────────────────────────────────────────

function PulseRing({
  delay,
  color,
  speed,
}: {
  delay: number;
  color: string;
  speed: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    const timer = setTimeout(() => {
      progress.value = withRepeat(
        withTiming(1, { duration: speed, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      progress.value = 0;
    };
  }, [speed, delay]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.75]) }],
    opacity: interpolate(progress.value, [0, 0.3, 1], [0.18, 0.12, 0]),
  }));

  return (
    <Animated.View
      style={[styles.pulseRing, { borderColor: color }, animStyle]}
    />
  );
}

// ─── AudioWaveform ────────────────────────────────────────────────────────────

function WaveBar({ delay }: { delay: number }) {
  const height = useSharedValue(4);

  useEffect(() => {
    const timer = setTimeout(() => {
      height.value = withRepeat(
        withSequence(
          withTiming(24, { duration: 300, easing: Easing.inOut(Easing.ease) }),
          withTiming(4, { duration: 300, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      height.value = 4;
    };
  }, [delay]);

  const barStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return <Animated.View style={[styles.waveBar, barStyle]} />;
}

function AudioWaveform() {
  const delays = [0, 100, 200, 100, 0];
  return (
    <View style={styles.waveform}>
      {delays.map((d, i) => (
        <WaveBar key={i} delay={d} />
      ))}
    </View>
  );
}

// ─── LoadingDots ──────────────────────────────────────────────────────────────

function LoadingDot({ delay }: { delay: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    const timer = setTimeout(() => {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 400 }),
          withTiming(0.3, { duration: 400 })
        ),
        -1,
        false
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      opacity.value = 0.3;
    };
  }, [delay]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.loadingDot, dotStyle]} />;
}

function LoadingDots() {
  const delays = [0, 150, 300];
  return (
    <View style={styles.loadingDotsRow}>
      {delays.map((d, i) => (
        <LoadingDot key={i} delay={d} />
      ))}
    </View>
  );
}

// ─── EventCard ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  index,
}: {
  event: CalendarEvent;
  index: number;
}) {
  const translateY = useSharedValue(20);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 300 });
    }, index * 120);
    return () => clearTimeout(timer);
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const formatEventDateTime = (date: string, time: string): string => {
    try {
      const d = new Date(`${date}T${time}:00`);
      return (
        d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        }) +
        " at " +
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      );
    } catch {
      return `${date} at ${time}`;
    }
  };

  return (
    <Animated.View style={[styles.eventCard, cardStyle]}>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.eventDateTime}>
        {formatEventDateTime(event.date, event.time)}
      </Text>
      {event.description ? (
        <Text style={styles.eventDesc}>{event.description}</Text>
      ) : null}
    </Animated.View>
  );
}

// ─── SiriSheet ────────────────────────────────────────────────────────────────

export default function SiriSheet({ visible, onClose }: SiriSheetProps) {
  const queryClient = useQueryClient();
  const [sheetState, setSheetState] = useState<SheetState>("idle");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [addedToCalendar, setAddedToCalendar] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sheet slide animation
  const sheetTranslateY = useSharedValue(450);
  // Backdrop opacity
  const backdropOpacity = useSharedValue(0);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // Open / close animation driven by `visible`
  useEffect(() => {
    if (visible) {
      // Reset state when opening
      setSheetState("idle");
      setEvents([]);
      setAddedToCalendar(false);
      setError(null);
      setRecordingDuration(0);

      sheetTranslateY.value = 450;
      backdropOpacity.value = 0;

      // Animate in
      sheetTranslateY.value = withSpring(0, {
        damping: 22,
        stiffness: 280,
        mass: 1,
      });
      backdropOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    // Stop any ongoing recording first
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => null);
      recordingRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    sheetTranslateY.value = withTiming(
      450,
      { duration: 280, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(onClose)();
        }
      }
    );
    backdropOpacity.value = withTiming(0, { duration: 220 });
  }, [onClose]);

  const formatDuration = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── Recording logic ────────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      setError(null);

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
        setRecordingDuration(
          Math.floor((Date.now() - startTimeRef.current) / 1000)
        );
      }, 1000);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSheetState("recording");
    } catch {
      setError("Could not access microphone.");
    }
  };

  const stopRecording = async () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const duration = (Date.now() - startTimeRef.current) / 1000;
    const recording = recordingRef.current;
    recordingRef.current = null;

    if (!recording) return;

    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    if (duration < 1) {
      setSheetState("idle");
      setError("Hold longer and speak your plans.");
      return;
    }

    const uri = recording.getURI();
    if (!uri) {
      setSheetState("idle");
      return;
    }

    setSheetState("processing");

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

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const backend = getBackendBaseUrl();
      if (!backend) {
        setError(
          "EXPO_PUBLIC_BACKEND_URL is missing. Add your backend URL to mobile/.env (LAN IP:3000 on a real phone)."
        );
        setSheetState("idle");
        return;
      }

      const response = await fetch(`${backend}/api/transcribe`, {
          method: "POST",
          body: formData,
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
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
        setSheetState("idle");
        return;
      }

      const parsed: CalendarEvent[] = data?.data?.events ?? [];
      if (parsed.length === 0) {
        setError("No events found. Try speaking more clearly.");
        setSheetState("idle");
        return;
      }

      setEvents(parsed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSheetState("results");
    } catch {
      setError(explainBackendConnectionFailure());
      setSheetState("idle");
    }
  };

  // ── Calendar logic ─────────────────────────────────────────────────────────

  const handleAddToCalendar = async () => {
    try {
      // Prefer Google Calendar if connected.
      try {
        const status = await api.get<{ connected: boolean }>("/api/google-calendar/status");
        if (status?.connected) {
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
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
          setTimeout(() => {
            handleClose();
          }, 1500);
          return;
        }
      } catch {
        // Fall back to device calendar on any Google errors.
      }

      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please grant calendar access in Settings."
        );
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT
      );
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

      // Auto-close after 1.5s
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch {
      Alert.alert("Error", "Could not add events to calendar.");
    }
  };

  // ── Prompt text by state ───────────────────────────────────────────────────

  const promptText = (): string => {
    switch (sheetState) {
      case "idle":
        return "What's on your schedule?";
      case "recording":
        return "Listening...";
      case "processing":
        return "Adding to your calendar...";
      case "results":
        return `Found ${events.length} event${events.length !== 1 ? "s" : ""}`;
    }
  };

  // ── Button area ────────────────────────────────────────────────────────────

  const buttonBgColor =
    sheetState === "recording" ? "#C0392B" : "#1a1a18";

  const pulseColor =
    sheetState === "recording" ? "#C0392B" : "#1a1a18";

  const pulseSpeed = sheetState === "recording" ? 700 : 2200;

  const showPulse =
    sheetState === "idle" || sheetState === "recording";

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={handleClose}
      testID="siri-sheet-modal"
    >
      <View style={StyleSheet.absoluteFillObject}>
        {/* Blur backdrop */}
        <BlurView
          style={StyleSheet.absoluteFillObject}
          tint="dark"
          intensity={60}
        />
        {/* Dark overlay on top of blur */}
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: "rgba(0,0,0,0.3)" },
            backdropAnimStyle,
          ]}
        />

        {/* Backdrop tap-to-close — sits behind sheet */}
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={handleClose}
          testID="siri-sheet-backdrop"
        />

        {/* Sheet */}
        <Animated.View style={[styles.sheet, sheetStyle]}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Title */}
          <Text style={styles.sheetTitle}>Button</Text>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Prompt text */}
          <Text style={styles.promptText}>{promptText()}</Text>

          {/* Button circle (not shown in results state) */}
          {sheetState !== "results" ? (
            <View style={styles.buttonArea}>
              {showPulse ? (
                <>
                  <PulseRing delay={0} color={pulseColor} speed={pulseSpeed} />
                  <PulseRing
                    delay={pulseSpeed / 3}
                    color={pulseColor}
                    speed={pulseSpeed}
                  />
                  <PulseRing
                    delay={(pulseSpeed / 3) * 2}
                    color={pulseColor}
                    speed={pulseSpeed}
                  />
                </>
              ) : null}

              <Pressable
                onPressIn={sheetState === "idle" ? startRecording : undefined}
                onPressOut={
                  sheetState === "recording" ? stopRecording : undefined
                }
                disabled={sheetState === "processing"}
                testID="siri-record-button"
              >
                <View
                  style={[
                    styles.micButton,
                    { backgroundColor: buttonBgColor },
                  ]}
                >
                  {sheetState === "processing" ? (
                    <ActivityIndicator color="#ffffff" size="large" />
                  ) : (
                    <Mic size={32} color="#ffffff" strokeWidth={1.5} />
                  )}
                </View>
              </Pressable>
            </View>
          ) : null}

          {/* Label / duration */}
          {sheetState !== "results" ? (
            <Text style={styles.holdLabel}>
              {sheetState === "recording"
                ? formatDuration(recordingDuration)
                : "HOLD TO SPEAK"}
            </Text>
          ) : null}

          {/* State-specific content below label */}
          {sheetState === "recording" ? (
            <AudioWaveform />
          ) : null}

          {sheetState === "processing" ? (
            <LoadingDots />
          ) : null}

          {/* Error */}
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {/* Results */}
          {sheetState === "results" ? (
            <View style={styles.resultsContainer}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={styles.eventList}
              >
                {events.map((ev, i) => (
                  <EventCard key={i} event={ev} index={i} />
                ))}
              </ScrollView>

              {addedToCalendar ? (
                <View style={styles.successRow}>
                  <Check size={18} color="#2ecc71" strokeWidth={2.5} />
                  <Text style={styles.successText}>Added to calendar!</Text>
                </View>
              ) : (
                <Pressable
                  style={styles.addButton}
                  onPress={handleAddToCalendar}
                  testID="siri-add-to-calendar"
                >
                  <Text style={styles.addButtonText}>Add to Calendar</Text>
                </Pressable>
              )}

              <Pressable
                onPress={handleClose}
                testID="siri-done-button"
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 420,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 16,
    zIndex: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d0d0d0",
    alignSelf: "center",
    marginTop: 12,
  },
  sheetTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 18,
    color: "#1a1a18",
    textAlign: "center",
    marginTop: 12,
  },
  divider: {
    height: 0.5,
    backgroundColor: "#e8e8e4",
    marginTop: 12,
    marginHorizontal: 0,
  },
  promptText: {
    fontFamily: "DMSans_300Light",
    fontSize: 15,
    color: "#9a9a95",
    textAlign: "center",
    marginTop: 20,
  },
  buttonArea: {
    width: 160,
    height: 160,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  pulseRing: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
  },
  micButton: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  holdLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 10,
    color: "#9a9a95",
    letterSpacing: 3,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 14,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: "#C0392B",
    marginHorizontal: 2,
  },
  loadingDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#9a9a95",
  },
  errorText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: "#C0392B",
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 16,
  },
  resultsContainer: {
    flex: 1,
    marginTop: 12,
  },
  eventList: {
    flex: 1,
  },
  eventCard: {
    backgroundColor: "#f9f9f7",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  eventTitle: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: "#1a1a18",
    marginBottom: 3,
  },
  eventDateTime: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    color: "#9a9a95",
  },
  eventDesc: {
    fontFamily: "DMSans_300Light",
    fontSize: 12,
    color: "#9a9a95",
    marginTop: 3,
  },
  addButton: {
    backgroundColor: "#1a1a18",
    height: 48,
    borderRadius: 50,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
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
    height: 48,
    marginTop: 8,
  },
  successText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: "#2ecc71",
  },
  doneText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: "#9a9a95",
    textAlign: "center",
    marginTop: 10,
  },
});
