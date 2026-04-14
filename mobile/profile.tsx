import React from "react";
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useSession } from "@/lib/auth/use-session";
import { api } from "@/lib/api/api";

type BadgeRow = { badgeType: string; earnedAt: string };

type PlanningProfile = {
  currentStreak: number;
  longestStreak: number;
  weeklyScore: number;
  totalVoiceSessions: number;
  totalEventsScheduled: number;
  isPro: boolean;
  username: string | null;
  displayName: string | null;
  memberSince: string;
  badges: BadgeRow[];
};

function badgeLabel(type: string): string {
  const map: Record<string, string> = {
    first_plan: "First Plan",
    streak_3: "3-Day Streak",
    streak_7: "7-Day Streak",
    streak_30: "30-Day Streak",
    streak_100: "100-Day Streak",
    early_riser: "Early Riser",
    weekend_warrior: "Weekend Warrior",
    speed_demon: "Speed Demon",
    power_planner: "Power Planner",
    consistency_king: "Consistency King",
  };
  return map[type] ?? type;
}

export default function ProfileScreen() {
  const { data: session } = useSession();
  const { data: p } = useQuery<PlanningProfile>({
    queryKey: ["planning-profile"],
    queryFn: async () => {
      const res = await api.get<PlanningProfile>("/api/user/planning-profile");
      return res as PlanningProfile;
    },
    enabled: Boolean(session?.user),
  });

  const name = p?.displayName ?? p?.username ?? session?.user?.email?.split("@")[0] ?? "You";
  const handle = p?.username;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.slice(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{name}</Text>
          {handle ? <Text style={styles.handle}>@{handle}</Text> : null}
          {!p?.isPro ? (
            <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push("/pricing")}>
              <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>🔥 {p?.currentStreak ?? 0}</Text>
            <Text style={styles.statLabel}>Current streak</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{p?.longestStreak ?? 0}</Text>
            <Text style={styles.statLabel}>Best streak</Text>
          </View>
          {p?.isPro ? (
            <View style={styles.stat}>
              <Text style={styles.statValue}>{p?.weeklyScore ?? 0}</Text>
              <Text style={styles.statLabel}>Weekly score</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ALL TIME</Text>
          <View style={styles.card}>
            <Text style={styles.row}>Voice sessions: {p?.totalVoiceSessions ?? 0}</Text>
            <Text style={styles.row}>Events scheduled: {p?.totalEventsScheduled ?? 0}</Text>
            {p?.memberSince ? (
              <Text style={styles.rowMuted}>Member since {new Date(p.memberSince).toLocaleDateString()}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BADGES</Text>
          <View style={styles.badgeGrid}>
            {(p?.badges ?? []).map((b) => (
              <View key={b.badgeType} style={styles.badgePill}>
                <Text style={styles.badgeText}>{badgeLabel(b.badgeType)}</Text>
              </View>
            ))}
            {p?.isPro && (p?.badges?.length ?? 0) === 0 ? (
              <Text style={styles.rowMuted}>Plan with Button to earn your first badges.</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.hint}>
          v1: Share a profile graphic from screenshots. Web share link at buttonapp.co comes in v2.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 24, paddingBottom: 48, gap: 20 },
  title: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 32,
    color: "#1a1a18",
  },
  hero: { alignItems: "center", gap: 8 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#1a1a18",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: "DMSans_500Medium", fontSize: 24, color: "#ffffff" },
  name: { fontFamily: "DMSans_500Medium", fontSize: 22, color: "#1a1a18" },
  handle: { fontFamily: "DMSans_400Regular", fontSize: 14, color: "#9a9a95" },
  upgradeBtn: {
    marginTop: 8,
    backgroundColor: "#1a1a18",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  upgradeBtnText: { fontFamily: "DMSans_500Medium", color: "#ffffff", fontSize: 14 },
  statsRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 8 },
  stat: { alignItems: "center", gap: 4 },
  statValue: { fontFamily: "DMSans_500Medium", fontSize: 18, color: "#1a1a18" },
  statLabel: { fontFamily: "DMSans_300Light", fontSize: 11, color: "#9a9a95" },
  section: { gap: 8 },
  sectionLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
    letterSpacing: 1.2,
    color: "#9a9a95",
  },
  card: {
    backgroundColor: "#f9f9f7",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0dc",
    gap: 8,
  },
  row: { fontFamily: "DMSans_400Regular", fontSize: 15, color: "#1a1a18" },
  rowMuted: { fontFamily: "DMSans_300Light", fontSize: 13, color: "#9a9a95" },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badgePill: {
    backgroundColor: "#f0f0ec",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0dc",
  },
  badgeText: { fontFamily: "DMSans_500Medium", fontSize: 12, color: "#1a1a18" },
  hint: { fontFamily: "DMSans_300Light", fontSize: 12, color: "#c0c0bc", marginTop: 12 },
});
