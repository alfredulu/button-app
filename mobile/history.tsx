import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { ChevronDown, Calendar } from "lucide-react-native";
import { api } from "@/lib/api/api";
import { useFocusEffect } from "@react-navigation/native";

type CalendarEvent = {
  id: string;
  title: string;
  eventDate: string;
  eventTime: string;
  description: string | null;
};

type VoiceSession = {
  id: string;
  transcript: string;
  eventCount: number;
  durationSecs: number;
  createdAt: string;
  events: CalendarEvent[];
};

function SessionRow({
  session,
  index,
}: {
  session: VoiceSession;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rotation = useSharedValue(0);
  const rowOpacity = useSharedValue(0);
  const rowY = useSharedValue(16);
  const contentOpacity = useSharedValue(0);
  const contentY = useSharedValue(8);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const rowStyle = useAnimatedStyle(() => ({
    opacity: rowOpacity.value,
    transform: [{ translateY: rowY.value }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentY.value }],
  }));

  useEffect(() => {
    const delay = index * 50;
    const timer = setTimeout(() => {
      rowOpacity.value = withTiming(1, {
        duration: 350,
        easing: Easing.out(Easing.cubic),
      });
      rowY.value = withTiming(0, {
        duration: 350,
        easing: Easing.out(Easing.cubic),
      });
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  const toggle = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    rotation.value = withTiming(nextExpanded ? 180 : 0, { duration: 200 });

    if (nextExpanded) {
      contentOpacity.value = 0;
      contentY.value = 8;
      contentOpacity.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
      contentY.value = withTiming(0, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      contentOpacity.value = withTiming(0, { duration: 150 });
    }
  };

  const date = new Date(session.createdAt);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const snippet =
    session.transcript.length > 70
      ? session.transcript.slice(0, 70) + "…"
      : session.transcript;

  return (
    <Animated.View style={[styles.sessionCard, rowStyle]}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={styles.sessionHeader}
      >
        <View style={styles.sessionMeta}>
          <Text style={styles.sessionDate}>{dateStr}</Text>
          <Text style={styles.sessionCount}>
            {session.eventCount} event{session.eventCount !== 1 ? "s" : ""}{" "}
            added
          </Text>
          <Text style={styles.sessionSnippet}>"{snippet}"</Text>
        </View>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={18} color="#9a9a95" strokeWidth={1.5} />
        </Animated.View>
      </TouchableOpacity>

      {expanded ? (
        <Animated.View style={[styles.eventsList, contentStyle]}>
          <View style={styles.divider} />
          {session.events.map((ev) => (
            <View key={ev.id} style={styles.eventItem}>
              <View style={styles.eventDot} />
              <View style={styles.eventItemContent}>
                <Text style={styles.eventItemTitle}>{ev.title}</Text>
                <Text style={styles.eventItemTime}>
                  {ev.eventDate} · {ev.eventTime}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export default function HistoryScreen() {
  const {
    data: sessions,
    isLoading,
    refetch,
  } = useQuery<VoiceSession[]>({
    queryKey: ["sessions"],
    queryFn: () => api.get<VoiceSession[]>("/api/sessions"),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const [refreshing, setRefreshing] = useState(false);

  // Header entrance animation
  const headerOpacity = useSharedValue(0);
  const headerY = useSharedValue(16);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));

  useEffect(() => {
    headerOpacity.value = withTiming(1, {
      duration: 350,
      easing: Easing.out(Easing.cubic),
    });
    headerY.value = withTiming(0, {
      duration: 350,
      easing: Easing.out(Easing.cubic),
    });
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.header, headerStyle]}>
        <Text style={styles.title}>History</Text>
      </Animated.View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#1a1a18" testID="loading-indicator" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#9a9a95"
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {!sessions || sessions.length === 0 ? (
            <View style={styles.emptyState} testID="empty-state">
              <Calendar size={48} color="#e0e0dc" strokeWidth={1} />
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.emptySubtitle}>
                Hold the button to start planning
              </Text>
            </View>
          ) : (
            sessions.map((s, i) => (
              <SessionRow key={s.id} session={s} index={i} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20 },
  title: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 32,
    color: "#1a1a18",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  sessionCard: {
    backgroundColor: "#f9f9f7",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0dc",
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  sessionMeta: { flex: 1, gap: 3 },
  sessionDate: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: "#1a1a18",
  },
  sessionCount: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: "#9a9a95",
  },
  sessionSnippet: {
    fontFamily: "DMSans_300Light",
    fontSize: 12,
    color: "#9a9a95",
    fontStyle: "italic",
    marginTop: 2,
  },
  eventsList: { marginTop: 12, gap: 8 },
  divider: { height: 1, backgroundColor: "#e0e0dc", marginBottom: 12 },
  eventItem: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#1a1a18",
    marginTop: 6,
  },
  eventItemContent: { flex: 1 },
  eventItemTitle: {
    fontFamily: "DMSans_500Medium",
    fontSize: 14,
    color: "#1a1a18",
  },
  eventItemTime: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    color: "#9a9a95",
    marginTop: 1,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: "PlayfairDisplay_400Regular",
    fontSize: 22,
    color: "#1a1a18",
    marginTop: 8,
  },
  emptySubtitle: {
    fontFamily: "DMSans_300Light",
    fontSize: 14,
    color: "#9a9a95",
  },
});
