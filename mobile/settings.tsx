import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Platform,
  TextInput,
} from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import Purchases from "react-native-purchases";
import { supabase } from "@/lib/auth/supabase";
import { useSession } from "@/lib/auth/use-session";
import { api } from "@/lib/api/api";
import {
  ensureReminderPermissions,
  getReminderSettings,
  setReminderSettings,
  syncExpoPushTokenToBackend,
  type ReminderSettings,
} from "@/lib/notifications";
import { router } from "expo-router";

type PlanStatus = {
  plan: string;
  isPro: boolean;
};

type GoogleCalendarStatus = {
  connected: boolean;
};

type PlanningProfile = {
  isPro: boolean;
  phoneNumber: string | null;
  verifiedPhone: boolean;
  smsRemindersEnabled: boolean;
  defaultReminderKind: string;
  username: string | null;
  displayName: string | null;
};

const REMINDER_KINDS: { key: string; label: string }[] = [
  { key: "15", label: "15 min" },
  { key: "30", label: "30 min" },
  { key: "60", label: "1 hour" },
  { key: "120", label: "2 hours" },
  { key: "morning", label: "Morning (8am)" },
];

WebBrowser.maybeCompleteAuthSession();

export default function SettingsScreen() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [reminders, setReminders] = useState<ReminderSettings>({ enabled: false, minutesBefore: 10 });
  const [phoneInput, setPhoneInput] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [partnerUsername, setPartnerUsername] = useState("");
  const { data: planStatus } = useQuery<PlanStatus>({
    queryKey: ["plan-status"],
    queryFn: async () => {
      const result = await api.get<PlanStatus>("/api/user/plan-status");
      return result ?? { plan: "free", isPro: false };
    },
  });

  const { data: googleStatus } = useQuery<GoogleCalendarStatus>({
    queryKey: ["google-calendar-status"],
    queryFn: async () => {
      const result = await api.get<GoogleCalendarStatus>("/api/google-calendar/status");
      return result ?? { connected: false };
    },
    enabled: !!session?.user,
  });

  const { data: planningProfile, refetch: refetchPlanning } = useQuery<PlanningProfile>({
    queryKey: ["planning-profile"],
    queryFn: async () => {
      const result = await api.get<PlanningProfile>("/api/user/planning-profile");
      return (
        result ?? {
          isPro: false,
          phoneNumber: null,
          verifiedPhone: false,
          smsRemindersEnabled: false,
          defaultReminderKind: "60",
          username: null,
          displayName: null,
        }
      );
    },
    enabled: !!session?.user,
  });

  const user = session?.user;
  const displayName = user?.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();
  const isPro = planStatus?.isPro ?? false;
  const googleConnected = googleStatus?.connected ?? false;

  useEffect(() => {
    getReminderSettings().then(setReminders).catch(() => {});
  }, []);

  useEffect(() => {
    if (planningProfile?.phoneNumber) setPhoneInput(planningProfile.phoneNumber);
  }, [planningProfile?.phoneNumber]);

  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ scheme: "vibecode", path: "google-calendar" }),
    []
  );

  const handleToggleGoogleCalendar = async (nextValue: boolean) => {
    if (!session?.user) {
      Alert.alert("Sign in required", "Please sign in to connect Google Calendar.");
      return;
    }

    if (!nextValue) {
      try {
        await api.post<{ connected: boolean }>("/api/google-calendar/disconnect", {});
        await queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      } catch {
        Alert.alert("Error", "Could not disconnect Google Calendar.");
      }
      return;
    }

    try {
      const { url } = await api.get<{ url: string }>("/api/google-calendar/auth-url");
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type !== "success") return;
      await queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not connect Google Calendar.");
    }
  };

  const handleManageSubscription = async () => {
    // Prefer RevenueCat helper if available, but keep robust fallbacks.
    try {
      const anyPurchases = Purchases as unknown as { showManageSubscriptions?: () => Promise<void> | void };
      if (typeof anyPurchases.showManageSubscriptions === "function") {
        await anyPurchases.showManageSubscriptions();
        return;
      }
    } catch {
      // fall through to Linking
    }

    const url =
      Platform.OS === "ios"
        ? "https://apps.apple.com/account/subscriptions"
        : "https://play.google.com/store/account/subscriptions";
    const can = await Linking.canOpenURL(url);
    if (!can) {
      Alert.alert("Unavailable", "Could not open subscription management on this device.");
      return;
    }
    await Linking.openURL(url);
  };

  const updateReminders = async (next: ReminderSettings) => {
    setReminders(next);
    await setReminderSettings(next);
    if (next.enabled && session?.user) {
      const ok = await ensureReminderPermissions();
      if (ok) await syncExpoPushTokenToBackend();
    }
  };

  const patchPlanningSettings = async (body: Record<string, unknown>) => {
    await api.patch("/api/user/settings", body);
    await refetchPlanning();
    await queryClient.invalidateQueries({ queryKey: ["planning-profile"] });
  };

  const handleSendPhoneCode = async () => {
    try {
      await api.post("/api/user/phone/send-code", { phone: phoneInput.trim() });
      Alert.alert("Code sent", "Check your SMS for a 6-digit code.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not send code.";
      Alert.alert("Error", msg);
    }
  };

  const handleVerifyPhone = async () => {
    try {
      await api.post("/api/user/phone/verify", { code: smsCode.trim() });
      setSmsCode("");
      await refetchPlanning();
      Alert.alert("Verified", "Your number is confirmed.");
    } catch {
      Alert.alert("Error", "Invalid or expired code.");
    }
  };

  const handleConnectPartner = async () => {
    try {
      await api.post("/api/social/partner", { username: partnerUsername.trim().toLowerCase() });
      setPartnerUsername("");
      Alert.alert("Connected", "You’re now accountability partners.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not connect.";
      Alert.alert("Error", msg);
    }
  };

  const handleSignOut = async () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        {/* Profile */}
        <View style={styles.profileCard}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
          </View>
          <View style={[styles.planBadge, isPro && styles.planBadgePro]}>
            <Text style={[styles.planBadgeText, isPro && styles.planBadgeTextPro]}>
              {isPro ? "Pro" : "Free"}
            </Text>
          </View>
        </View>

        {/* Calendar section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CALENDAR</Text>
          <View style={styles.sectionCard}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Apple Calendar</Text>
              <Switch
                value={true}
                trackColor={{ false: "#e0e0dc", true: "#1a1a18" }}
                thumbColor="#ffffff"
              />
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.row}>
              <View>
                <Text style={styles.rowLabel}>Google Calendar</Text>
                <Text style={styles.rowNote}>
                  {googleConnected ? "Connected" : "Connect to sync events"}
                </Text>
              </View>
              <Switch
                value={googleConnected}
                onValueChange={handleToggleGoogleCalendar}
                trackColor={{ false: "#e0e0dc", true: "#1a1a18" }}
                thumbColor="#ffffff"
              />
            </View>
          </View>
        </View>

        {/* SMS (Pro) */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SMS REMINDERS</Text>
          <View style={styles.sectionCard}>
            {!isPro ? (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push("/pricing")}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Text reminders via Twilio</Text>
                  <Text style={styles.rowNote}>Pro feature — upgrade to enable</Text>
                </View>
                <ChevronRight size={16} color="#9a9a95" strokeWidth={1.5} />
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>SMS reminders</Text>
                    <Text style={styles.rowNote}>
                      {planningProfile?.verifiedPhone ? "Phone verified" : "Verify your mobile number"}
                    </Text>
                  </View>
                  <Switch
                    value={Boolean(planningProfile?.smsRemindersEnabled && planningProfile?.verifiedPhone)}
                    onValueChange={(v) =>
                      patchPlanningSettings({ smsRemindersEnabled: v }).catch(() =>
                        Alert.alert("Error", "Could not update SMS setting.")
                      )
                    }
                    trackColor={{ false: "#e0e0dc", true: "#1a1a18" }}
                    thumbColor="#ffffff"
                    disabled={!planningProfile?.verifiedPhone}
                  />
                </View>
                <View style={styles.rowDivider} />
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                  <Text style={styles.rowLabel}>Phone (E.164, e.g. +15551234567)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    placeholder="+1..."
                    placeholderTextColor="#9a9a95"
                    autoCapitalize="none"
                    keyboardType="phone-pad"
                  />
                  <TouchableOpacity style={styles.smallBtn} onPress={handleSendPhoneCode}>
                    <Text style={styles.smallBtnText}>Send code</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.textInput}
                    value={smsCode}
                    onChangeText={setSmsCode}
                    placeholder="6-digit code"
                    placeholderTextColor="#9a9a95"
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                  <TouchableOpacity style={styles.smallBtn} onPress={handleVerifyPhone}>
                    <Text style={styles.smallBtnText}>Verify</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.rowDivider} />
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text style={styles.rowLabel}>Default lead time</Text>
                  <View style={styles.pillsRow}>
                    {REMINDER_KINDS.map(({ key, label }) => {
                      const selected = (planningProfile?.defaultReminderKind ?? "60") === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[styles.pill, selected && styles.pillSelected]}
                          onPress={() =>
                            patchPlanningSettings({ defaultReminderKind: key }).catch(() => {})
                          }
                        >
                          <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Accountability (Pro) */}
        {isPro ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ACCOUNTABILITY PARTNER</Text>
            <View style={styles.sectionCard}>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                <Text style={styles.rowNote}>Connect with one partner (username). You’ll see streak & weekly score.</Text>
                <TextInput
                  style={styles.textInput}
                  value={partnerUsername}
                  onChangeText={setPartnerUsername}
                  placeholder="username"
                  placeholderTextColor="#9a9a95"
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.smallBtn} onPress={handleConnectPartner}>
                  <Text style={styles.smallBtnText}>Connect</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.sectionCard}>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={handleManageSubscription}
            >
              <Text style={styles.rowLabel}>Manage Subscription</Text>
              <ChevronRight size={16} color="#9a9a95" strokeWidth={1.5} />
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => {}}
            >
              <View>
                <Text style={styles.rowLabel}>Reminders</Text>
                <Text style={styles.rowNote}>
                  {reminders.enabled ? `${reminders.minutesBefore} min before` : "Off"}
                </Text>
              </View>
              <Switch
                value={reminders.enabled}
                onValueChange={(v) => updateReminders({ ...reminders, enabled: v }).catch(() => {})}
                trackColor={{ false: "#e0e0dc", true: "#1a1a18" }}
                thumbColor="#ffffff"
              />
            </TouchableOpacity>
            {reminders.enabled ? (
              <>
                <View style={styles.rowDivider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Remind me</Text>
                  <View style={styles.pillsRow}>
                    {[5, 10, 30].map((m) => {
                      const selected = reminders.minutesBefore === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          style={[styles.pill, selected && styles.pillSelected]}
                          activeOpacity={0.8}
                          onPress={() =>
                            updateReminders({ ...reminders, minutesBefore: m as 5 | 10 | 30 }).catch(() => {})
                          }
                        >
                          <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{m}m</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : null}
            <View style={styles.rowDivider} />
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handleSignOut}>
              <Text style={styles.rowLabelDanger}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.version}>Button v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 24, paddingBottom: 48, gap: 24 },
  title: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 32,
    color: "#1a1a18",
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#f9f9f7",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0dc",
  },
  avatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1a1a18",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLargeText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 20,
    color: "#ffffff",
  },
  profileInfo: { flex: 1, gap: 2 },
  profileName: {
    fontFamily: "DMSans_500Medium",
    fontSize: 17,
    color: "#1a1a18",
  },
  profileEmail: {
    fontFamily: "DMSans_300Light",
    fontSize: 13,
    color: "#9a9a95",
  },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 50,
    backgroundColor: "#f0f0ec",
    borderWidth: 1,
    borderColor: "#e0e0dc",
  },
  planBadgePro: {
    backgroundColor: "#1a1a18",
    borderColor: "#1a1a18",
  },
  planBadgeText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
    color: "#9a9a95",
  },
  planBadgeTextPro: { color: "#ffffff" },
  section: { gap: 8 },
  sectionLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    color: "#9a9a95",
    letterSpacing: 1.5,
    paddingHorizontal: 4,
  },
  sectionCard: {
    backgroundColor: "#f9f9f7",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e0e0dc",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    minHeight: 52,
  },
  rowDivider: { height: 1, backgroundColor: "#e0e0dc", marginHorizontal: 16 },
  pillsRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f0f0ec",
    borderWidth: 1,
    borderColor: "#e0e0dc",
  },
  pillSelected: {
    backgroundColor: "#1a1a18",
    borderColor: "#1a1a18",
  },
  pillText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
    color: "#1a1a18",
  },
  pillTextSelected: { color: "#ffffff" },
  rowLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: "#1a1a18",
  },
  rowLabelMuted: { color: "#9a9a95" },
  rowLabelDanger: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: "#C0392B",
  },
  rowNote: {
    fontFamily: "DMSans_300Light",
    fontSize: 11,
    color: "#9a9a95",
    marginTop: 1,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#e0e0dc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: "#1a1a18",
  },
  smallBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1a18",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  smallBtnText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: "#ffffff",
  },
  version: {
    fontFamily: "DMSans_300Light",
    fontSize: 12,
    color: "#9a9a95",
    textAlign: "center",
    marginTop: 8,
  },
});
