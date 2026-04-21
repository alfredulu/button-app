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
  ScrollView,
  Keyboard,
  KeyboardEvent,
  Animated,
  TouchableWithoutFeedback,
} from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/auth/supabase";
import { ChevronLeft } from "lucide-react-native";

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

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isActive ? INK : isFilled ? "#b0b0aa" : BORDER_IDLE,
  }));

  return (
    <Reanimated.View style={[styles.codeBox, animStyle]}>
      <Text style={styles.codeText}>{digit || ""}</Text>
    </Reanimated.View>
  );
}

export default function Verify() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const email = Array.isArray(params.email) ? params.email[0] : params.email;

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  const inputRef = useRef<TextInput>(null);
  const hasVerifiedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  // Animated.Value so padding tracks keyboard frame-by-frame with no re-render
  const keyboardPad = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    const show = Keyboard.addListener(
      "keyboardWillShow",
      (e: KeyboardEvent) => {
        // Mirror the keyboard's own spring curve exactly
        Animated.timing(keyboardPad, {
          toValue: e.endCoordinates.height,
          duration: e.duration,
          useNativeDriver: false,
        }).start(() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        });
      }
    );

    const hide = Keyboard.addListener(
      "keyboardWillHide",
      (e: KeyboardEvent) => {
        Animated.timing(keyboardPad, {
          toValue: 0,
          duration: e.duration,
          useNativeDriver: false,
        }).start();
      }
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === 6 && !loading && !hasVerifiedRef.current) {
      hasVerifiedRef.current = true;
      setTimeout(() => handleVerify(), 120);
    }
  }, [code, loading]);

  useEffect(() => {
    const check = async () => {
      try {
        const text = await Clipboard.getStringAsync();
        if (/^\d{6}$/.test(text)) setCode(text);
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
        "That code didn't work. Try again or request a new one."
      );
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    successScale.value = withSpring(1.05);
    setTimeout(() => router.replace("/(app)"), 200);
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
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Back button — pinned above scroll, never affected by keyboard */}
      <Pressable
        style={styles.backButton}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.back();
        }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <ChevronLeft size={22} color={INK} strokeWidth={1.8} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      {/*
        TouchableWithoutFeedback wraps the ScrollView so tapping any
        empty space dismisses the keyboard — works reliably on iOS.
      */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <Animated.ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          // Animated.Value drives paddingBottom in sync with keyboard frames
          // We inject it via the Animated API on the content container
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Spacer that grows to push content to vertical center */}
          <View style={{ flex: 1 }} />

          <Reanimated.View style={successStyle}>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              Enter the 6-digit code sent to{" "}
              <Text style={styles.emailHighlight}>{email ?? "your email"}</Text>
            </Text>

            <View style={{ position: "relative" }}>
              <Pressable
                onPress={() => {
                  inputRef.current?.focus();
                  setTimeout(() => inputRef.current?.focus(), 50);
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

                <Reanimated.View style={[styles.codeRow, shakeStyle]}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <CodeBox
                      key={i}
                      digit={code[i] ?? ""}
                      isActive={!loading && activeIndex === i}
                      isFilled={i < code.length}
                    />
                  ))}
                </Reanimated.View>
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

            <Pressable
              onPress={handleResend}
              disabled={cooldown > 0}
              style={styles.resendButton}
            >
              <Text style={[styles.resend, cooldown > 0 && styles.resendMuted]}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Text>
            </Pressable>
          </Reanimated.View>

          {/* This bottom spacer is what the keyboard pushes against */}
          <Animated.View style={{ height: keyboardPad }} />
        </Animated.ScrollView>
      </TouchableWithoutFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 4,
  },
  backText: {
    fontSize: 15,
    color: INK,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 8,
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
  codeRow: {
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
  resendButton: {
    paddingVertical: 20,
    alignSelf: "center",
  },
  resend: { textAlign: "center", color: INK, fontSize: 15 },
  resendMuted: { opacity: 0.4 },
});
