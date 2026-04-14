import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { Redirect, useRouter, type Href } from "expo-router";
import { Bell } from "lucide-react-native";
import { useSession } from "@/lib/auth/use-session";
import { setPostSignupNotificationPending } from "@/lib/onboarding-flow";
import { syncExpoPushTokenToBackend } from "@/lib/notifications";

const INK = "#1a1a18";
const MUTED = "#9a9a95";

export default function NotificationPromptScreen() {
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  const finish = async () => {
    await setPostSignupNotificationPending(false);
    router.replace("/(app)" as Href);
  };

  const onTurnOn = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === "granted") {
      await syncExpoPushTokenToBackend();
    }
    await finish();
  };

  if (isLoading) return null;
  if (!session?.user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Bell size={56} color={INK} strokeWidth={1.25} />
        </View>
        <Text style={styles.headline}>Don’t forget your plans.</Text>
        <Text style={styles.body}>
          Button can remind you before every event so nothing slips through the cracks.
        </Text>
        <Pressable
          onPress={() => void onTurnOn()}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.92 }]}
        >
          <Text style={styles.primaryText}>Turn on reminders</Text>
        </Pressable>
        <Pressable onPress={() => void finish()} style={styles.secondaryWrap}>
          <Text style={styles.secondary}>Maybe later</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  inner: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  iconWrap: {
    marginBottom: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  headline: {
    fontFamily: "DMSerifDisplay_400Regular",
    fontSize: 32,
    color: INK,
    textAlign: "center",
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: "DMSans_300Light",
    fontSize: 17,
    lineHeight: 26,
    color: MUTED,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: 32,
  },
  primary: {
    backgroundColor: INK,
    borderRadius: 999,
    height: 54,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    maxWidth: 340,
  },
  primaryText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: "#ffffff",
  },
  secondaryWrap: { marginTop: 18, paddingVertical: 8 },
  secondary: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: MUTED,
  },
});
