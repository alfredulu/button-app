import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import React, { useState, useEffect, useRef } from "react";
import { Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
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

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isActive ? INK : isFilled ? "#b0b0aa" : BORDER_IDLE,
  }));

  return (
    <Animated.View style={[styles.codeBox, boxStyle]}>
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

  const successScale = useSharedValue(1);

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
  }));

  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
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
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === 6 && !loading) {
      handleVerify();
    }
  }, [code]);

  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const text = await Clipboard.getStringAsync();
        if (/^\d{6}$/.test(text)) setCode(text);
      } catch {}
    };
    void checkClipboard();
  }, []);

  const handleVerify = async () => {
    if (loading) return;

    if (!email) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", "Please start again.");
      return;
    }

    if (code.length < 6) return;

    setLoading(true);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setLoading(false);

    if (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      triggerShake();
      setCode("");
      inputRef.current?.focus();

      Alert.alert("Invalid code", "Check and try again.");
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
      Alert.alert("Error", error.message);
      return;
    }

    setCooldown(60);
  };

  const activeIndex = code.length === 6 ? 5 : code.length;

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.inner, successStyle]}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          We sent a code to{" "}
          <Text style={styles.emailHighlight}>{email ?? "your email"}</Text>
        </Text>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(text) => {
            const cleaned = text.replace(/[^0-9]/g, "").slice(0, 6);

            if (cleaned.length > code.length) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }

            setCode(cleaned);
          }}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.hiddenInput}
        />
        <Pressable
          onPress={async () => {
            inputRef.current?.focus();
            try {
              const text = await Clipboard.getStringAsync();
              if (/^\d{6}$/.test(text)) setCode(text);
            } catch {}
          }}
        >
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
        <Pressable
          style={[
            styles.button,
            (loading || code.length < 6) && styles.buttonDisabled,
          ]}
          onPress={handleVerify}
          disabled={loading || code.length < 6}
        >
          <Text style={styles.buttonText}>
            {loading ? "Verifying..." : "Verify"}
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
  container: { flex: 1, backgroundColor: "#ffffff" },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 34,
    color: INK,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: MUTED,
    marginBottom: 36,
  },
  emailHighlight: {
    color: INK,
    fontWeight: "500",
  },
  hiddenInput: {
    position: "absolute",
    width: "100%",
    height: 60,
    opacity: 0,
  },
  codeContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
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
  codeText: {
    fontSize: 24,
    color: INK,
  },
  button: {
    backgroundColor: INK,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
  },
  resend: {
    marginTop: 20,
    textAlign: "center",
    color: INK,
  },
  resendMuted: { opacity: 0.4 },
});
