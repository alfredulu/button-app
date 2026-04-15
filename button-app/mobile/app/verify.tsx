import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/auth/supabase";

const INK = "#1a1a18";
const MUTED = "#9a9a95";
const BORDER_IDLE = "#e0e0dc";

function CodeBox({
  digit,
  isActive,
  isFilled,
}: {
  digit: string;
  isActive: boolean;
  isFilled: boolean;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (digit) {
      scale.value = withSequence(withSpring(1.15), withSpring(1));
    }
  }, [digit]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isActive ? INK : isFilled ? "#b0b0aa" : BORDER_IDLE,
  }));

  return (
    <Animated.View style={[styles.codeBox, style]}>
      <Text style={styles.codeText}>{digit || ""}</Text>
    </Animated.View>
  );
}

export default function Verify() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const email = Array.isArray(params.email) ? params.email[0] : params.email;

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  const inputRef = useRef<TextInput>(null);
  const hasVerifiedRef = useRef(false);

  const shakeX = useSharedValue(0);
  const successScale = useSharedValue(1);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
  }));

  const triggerShake = () => {
    shakeX.value = withSequence(
      withTiming(-10),
      withTiming(10),
      withTiming(-6),
      withTiming(6),
      withTiming(0)
    );
  };

  // ✅ focus fix (iOS safe)
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 400); // slightly longer for Android

    return () => clearTimeout(t);
  }, []);

  // cooldown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === 6 && !loading && !hasVerifiedRef.current) {
      hasVerifiedRef.current = true;

      setTimeout(() => {
        handleVerify();
      }, 120);
    }
  }, [code, loading]);

  // clipboard autofill (no instant verify)
  useEffect(() => {
    const check = async () => {
      try {
        const text = await Clipboard.getStringAsync();
        if (/^\d{6}$/.test(text)) {
          setCode(text);
        }
      } catch {}
    };
    check();
  }, []);

  const handleVerify = async () => {
    if (loading) return;

    if (!email) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Something went wrong", "Please restart the login process.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setLoading(false);

    if (error) {
      hasVerifiedRef.current = false;

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      triggerShake();
      setCode("");
      inputRef.current?.focus();

      Alert.alert(
        "Invalid code",
        "That code didn’t work. Try again or request a new one."
      );
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    successScale.value = withSpring(1.05);

    setTimeout(() => {
      router.replace("/(app)");
    }, 200);
  };

  const handleResend = async () => {
    if (!email || cooldown > 0) return;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      if (error.message.toLowerCase().includes("rate")) {
        Alert.alert(
          "Too many attempts",
          "Please wait a bit before requesting another code."
        );
        return;
      }

      Alert.alert("Error", error.message);
      return;
    }

    setCooldown(60);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Alert.alert(
      "Code sent",
      "A new verification code has been sent to your email."
    );
  };

  const activeIndex = code.length === 6 ? 5 : code.length;

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.inner, successStyle]}>
        <Text style={styles.title}>Check your email</Text>

        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to{" "}
          <Text style={styles.emailHighlight}>{email ?? "your email"}</Text>
        </Text>

        {/* OTP INPUT AREA */}
        <View style={{ width: "100%", position: "relative" }}>
          <Pressable
            style={{ width: "100%" }} // 👈 REQUIRED
            onPress={() => {
              inputRef.current?.focus();

              setTimeout(() => {
                inputRef.current?.focus();
              }, 50);

              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, "").slice(0, 6);

                if (cleaned.length > code.length) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }

                setCode(cleaned);
                hasVerifiedRef.current = false;
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              autoFocus
              showSoftInputOnFocus
              maxLength={6}
              style={styles.hiddenInput}
            />

            <Animated.View style={[styles.codeContainer, shakeStyle]}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <CodeBox
                  key={i}
                  digit={code[i] ?? ""}
                  isActive={!loading && activeIndex === i}
                  isFilled={i < code.length}
                />
              ))}
            </Animated.View>
          </Pressable>
        </View>

        <Pressable
          style={[
            styles.button,
            (loading || code.length < 6) && styles.buttonDisabled,
          ]}
          onPress={handleVerify}
          disabled={loading || code.length < 6}
        >
          <Text style={styles.buttonText}>
            {loading ? "Checking..." : "Continue"}
          </Text>
        </Pressable>

        <Pressable onPress={handleResend} disabled={cooldown > 0}>
          <Text style={[styles.resend, cooldown > 0 && styles.resendMuted]}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 32,
    color: INK,
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: MUTED,
    marginBottom: 40,
    lineHeight: 22,
  },
  emailHighlight: { color: INK, fontWeight: "500" },
  hiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: 60,
    opacity: 0.05,
    zIndex: 10,
  },
  codeContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 36,
  },
  codeBox: {
    width: 48,
    height: 58,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  codeText: { fontSize: 24, color: INK },
  button: {
    backgroundColor: INK,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16 },
  resend: { marginTop: 20, textAlign: "center", color: INK },
  resendMuted: { opacity: 0.4 },
});
