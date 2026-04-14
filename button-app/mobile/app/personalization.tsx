import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useRouter, type Href } from "expo-router";
import { useSession } from "@/lib/auth/use-session";
import { api } from "@/lib/api/api";
import {
  setPostSignupNotificationPending,
  setPostSignupPersonalizationPending,
  type OnboardingDataPayload,
} from "@/lib/onboarding-flow";

const INK = "#1a1a18";
const MUTED = "#9a9a95";
const PILL = "#f0f0ee";

type Q1 = OnboardingDataPayload["planning_time"];
type Q2 = OnboardingDataPayload["user_type"];
type Q3 = OnboardingDataPayload["struggle"];

const Q1_OPTS: { label: string; value: Q1 }[] = [
  { label: "🌅 Morning", value: "morning" },
  { label: "☀️ Midday", value: "midday" },
  { label: "🌆 Evening", value: "evening" },
  { label: "🔀 Varies", value: "varies" },
];

const Q2_OPTS: { label: string; value: Q2 }[] = [
  { label: "💼 Professional", value: "professional" },
  { label: "🎓 Student", value: "student" },
  { label: "👨‍👩‍👧 Parent", value: "parent" },
  { label: "🚀 Founder", value: "founder" },
];

const Q3_OPTS: { label: string; value: Q3 }[] = [
  { label: "🤯 Forgetting plans", value: "forgetting" },
  { label: "⏰ No reminder system", value: "no_reminders" },
  { label: "📝 Manual entry is slow", value: "manual_entry" },
  { label: "🤷 I just don’t plan", value: "dont_plan" },
];

function Pill<T extends string>({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        selected ? { backgroundColor: INK } : { backgroundColor: PILL },
      ]}
    >
      <Text
        style={[
          styles.pillText,
          selected ? { color: "#ffffff" } : { color: INK },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function PersonalizationScreen() {
  const router = useRouter();
  const { data: session, isLoading: sessionLoading } = useSession();
  const [q1, setQ1] = useState<Q1 | null>(null);
  const [q2, setQ2] = useState<Q2 | null>(null);
  const [q3, setQ3] = useState<Q3 | null>(null);
  const [saving, setSaving] = useState(false);

  const goNotificationStep = async () => {
    await setPostSignupPersonalizationPending(false);
    await setPostSignupNotificationPending(true);
    router.replace("/notification-prompt" as Href);
  };

  const onSkip = async () => {
    setSaving(true);
    try {
      await api.patch("/api/user/settings", { onboardingData: null });
    } catch {
      Alert.alert("Could not save", "You can update preferences later in settings.");
    } finally {
      setSaving(false);
    }
    await goNotificationStep();
  };

  const onSubmit = async () => {
    if (q1 === null || q2 === null || q3 === null) {
      Alert.alert("Choose an option", "Please pick one answer for each question.");
      return;
    }
    const payload: OnboardingDataPayload = {
      planning_time: q1,
      user_type: q2,
      struggle: q3,
    };
    setSaving(true);
    try {
      await api.patch("/api/user/settings", { onboardingData: payload });
      await goNotificationStep();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      Alert.alert("Could not save", msg);
    } finally {
      setSaving(false);
    }
  };

  if (sessionLoading) return null;
  if (!session?.user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Quick setup</Text>
        <Text style={styles.subtitle}>Help Button work better for you.</Text>

        <Text style={styles.qLabel}>When do you usually plan your day?</Text>
        <View style={styles.pillWrap}>
          {Q1_OPTS.map((o) => (
            <Pill key={o.value} label={o.label} selected={q1 === o.value} onPress={() => setQ1(o.value)} />
          ))}
        </View>

        <Text style={styles.qLabel}>What best describes you?</Text>
        <View style={styles.pillWrap}>
          {Q2_OPTS.map((o) => (
            <Pill key={o.value} label={o.label} selected={q2 === o.value} onPress={() => setQ2(o.value)} />
          ))}
        </View>

        <Text style={styles.qLabel}>What’s your biggest scheduling struggle?</Text>
        <View style={styles.pillWrap}>
          {Q3_OPTS.map((o) => (
            <Pill key={o.value} label={o.label} selected={q3 === o.value} onPress={() => setQ3(o.value)} />
          ))}
        </View>

        <Pressable
          onPress={() => void onSubmit()}
          disabled={saving}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && !saving && { opacity: 0.92 },
            saving && { opacity: 0.6 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Let’s go 🎉</Text>
          )}
        </Pressable>

        <Pressable onPress={() => void onSkip()} disabled={saving} style={styles.skipLink}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  scroll: {
    paddingHorizontal: 28,
    paddingBottom: 40,
    paddingTop: 16,
  },
  title: {
    fontFamily: "DMSerifDisplay_400Regular",
    fontSize: 28,
    color: INK,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "DMSans_300Light",
    fontSize: 16,
    color: MUTED,
    marginBottom: 28,
  },
  qLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: INK,
    marginBottom: 12,
    marginTop: 8,
  },
  pillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 8,
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  pillText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: INK,
    borderRadius: 999,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 28,
  },
  primaryBtnText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: "#ffffff",
  },
  skipLink: { marginTop: 16, alignItems: "center", paddingVertical: 8 },
  skipText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: MUTED,
  },
});
