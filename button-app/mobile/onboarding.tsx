import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { Redirect, useRouter, type Href } from "expo-router";
import { supabase, isSupabaseConfigured } from "@/lib/auth/supabase";
import { useSession } from "@/lib/auth/use-session";

export default function Onboarding() {
  const router = useRouter();
  const { data: sessionData, isLoading: sessionLoading } = useSession();
  const authInFlight = useRef(false);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("signup");

  // Entrance animation shared values
  const logoOpacity = useSharedValue(0);
  const logoY = useSharedValue(20);
  const taglineOpacity = useSharedValue(0);
  const taglineY = useSharedValue(20);
  const ornamentOpacity = useSharedValue(0);
  const ornamentY = useSharedValue(20);
  const modeTitleOpacity = useSharedValue(0);
  const modeTitleY = useSharedValue(20);
  const emailOpacity = useSharedValue(0);
  const emailY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonY = useSharedValue(20);
  const termsOpacity = useSharedValue(0);
  const termsY = useSharedValue(20);

  const buttonScale = useSharedValue(1);
  const enterConfig = { duration: 350, easing: Easing.out(Easing.cubic) };

  useEffect(() => {
    const pairs: Array<[SharedValue<number>, SharedValue<number>, number]> = [
      [logoOpacity, logoY, 0],
      [taglineOpacity, taglineY, 80],
      [ornamentOpacity, ornamentY, 160],
      [modeTitleOpacity, modeTitleY, 260],
      [emailOpacity, emailY, 340],
      [buttonOpacity, buttonY, 420],
      [termsOpacity, termsY, 500],
    ];
    const timers = pairs.map(([opacity, y, delay]) =>
      setTimeout(() => {
        opacity.value = withTiming(1, enterConfig);
        y.value = withTiming(0, enterConfig);
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ translateY: logoY.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: taglineY.value }],
  }));
  const ornamentStyle = useAnimatedStyle(() => ({
    opacity: ornamentOpacity.value,
    transform: [{ translateY: ornamentY.value }],
  }));
  const modeTitleStyle = useAnimatedStyle(() => ({
    opacity: modeTitleOpacity.value,
    transform: [{ translateY: modeTitleY.value }],
  }));
  const emailInputStyle = useAnimatedStyle(() => ({
    opacity: emailOpacity.value,
    transform: [{ translateY: emailY.value }],
  }));
  const buttonContainerStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonY.value }],
  }));
  const termsAnimStyle = useAnimatedStyle(() => ({
    opacity: termsOpacity.value,
    transform: [{ translateY: termsY.value }],
  }));
  const btnPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const trimmedEmail = email.trim();
  const isValidEmail =
    trimmedEmail.length > 3 &&
    trimmedEmail.includes("@") &&
    trimmedEmail.includes(".");
  const isDisabled = !isValidEmail || loading;

  if (!sessionLoading && sessionData?.user && !authInFlight.current) {
    return <Redirect href="/" />;
  }

  const handleSubmit = async () => {
    if (loading) return;

    const trimmedEmail = email.trim();

    if (!isValidEmail) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }

    if (!isSupabaseConfigured()) {
      Alert.alert(
        "Supabase not configured",
        "Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to mobile/.env, then restart Expo with npx expo start --clear."
      );
      return;
    }

    authInFlight.current = true;
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          shouldCreateUser: mode === "signup",
        },
      });

      if (error) {
        // 🔥 safer login handling (don’t depend on exact message)
        if (mode === "login") {
          Alert.alert(
            "Unable to sign in",
            "Please make sure this email is registered or sign up instead."
          );
        } else {
          Alert.alert("Error", error.message);
        }

        authInFlight.current = false; // ✅ fix
        return;
      }

      router.push(`/verify?email=${encodeURIComponent(trimmedEmail)}`);
      authInFlight.current = false;
    } catch (e: unknown) {
      authInFlight.current = false;

      const raw = e instanceof Error ? e.message : String(e);

      const message =
        raw === "Network request failed" || raw.includes("fetch")
          ? "Check your internet connection and try again."
          : raw.toLowerCase().includes("rate")
            ? "Too many attempts. Please wait a bit before trying again."
            : raw || "Something went wrong. Please try again.";

      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Logo section */}
        <View style={styles.logoSection}>
          <Animated.Text style={[styles.logo, logoStyle]}>Button</Animated.Text>
          <Animated.Text style={[styles.tagline, taglineStyle]}>
            Plan Smart. Save Time.
          </Animated.Text>
          <Animated.View style={[styles.ornament, ornamentStyle]}>
            <View style={styles.ornamentDot} />
            <View style={[styles.ornamentLine, { width: 32 }]} />
            <View style={styles.ornamentDot} />
            <View style={[styles.ornamentLine, { width: 32 }]} />
            <View style={styles.ornamentDot} />
          </Animated.View>
        </View>

        {/* Auth section */}
        <View style={styles.authSection}>
          <Animated.Text style={[styles.modeTitle, modeTitleStyle]}>
            Enter your email
          </Animated.Text>
          <Animated.Text style={[styles.modeSubtitle, modeTitleStyle]}>
            We’ll send you a 6-digit code to continue.
          </Animated.Text>

          <View style={{ flexDirection: "row", marginBottom: 20 }}>
            <Pressable onPress={() => setMode("login")}>
              <Text
                style={{ marginRight: 16, opacity: mode === "login" ? 1 : 0.4 }}
              >
                Login
              </Text>
            </Pressable>

            <Pressable onPress={() => setMode("signup")}>
              <Text style={{ opacity: mode === "signup" ? 1 : 0.4 }}>
                Sign up
              </Text>
            </Pressable>
          </View>

          <Animated.View style={emailInputStyle}>
            <TextInput
              style={[styles.input, emailFocused && styles.inputFocused]}
              placeholder="you@email.com"
              placeholderTextColor="#9a9a95"
              value={email}
              onChangeText={(text) => setEmail(text.trimStart())}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="done"
              textContentType="emailAddress"
              autoFocus
              keyboardAppearance="light"
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              onSubmitEditing={handleSubmit}
            />
          </Animated.View>

          <Animated.View style={buttonContainerStyle}>
            <Pressable
              onPressIn={() => {
                if (!isDisabled) {
                  buttonScale.value = withSpring(0.96, {
                    damping: 18,
                    stiffness: 220,
                  });
                }
              }}
              onPressOut={() => {
                buttonScale.value = withSpring(1.0, {
                  damping: 18,
                  stiffness: 220,
                });
              }}
              onPress={handleSubmit}
              disabled={isDisabled}
              testID="submit-button"
            >
              <Animated.View
                style={[
                  styles.darkButton,
                  isDisabled && styles.darkButtonDisabled,
                  btnPressStyle,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.darkButtonText}>
                    {loading
                      ? "Sending..."
                      : mode === "login"
                        ? "Login"
                        : "Sign up"}
                  </Text>
                )}
              </Animated.View>
            </Pressable>
          </Animated.View>

          <Animated.Text style={[styles.termsText, termsAnimStyle]}>
            By continuing, you agree to our Terms and Privacy Policy.
          </Animated.Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  inner: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingBottom: 32,
  },
  logoSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
  },
  logo: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 72,
    color: "#1a1a18",
    letterSpacing: -1,
  },
  tagline: {
    fontFamily: "DMSans_300Light",
    fontSize: 16,
    color: "#9a9a95",
    marginTop: 8,
    letterSpacing: 0.5,
  },
  ornament: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 32,
  },
  ornamentDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e0e0dc",
  },
  ornamentLine: {
    height: 1,
    backgroundColor: "#e0e0dc",
  },
  authSection: { gap: 12 },
  modeTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 24,
    color: "#1a1a18",
    marginBottom: 2,
  },
  modeSubtitle: {
    fontFamily: "DMSans_300Light",
    fontSize: 14,
    color: "#9a9a95",
    lineHeight: 20,
    marginBottom: 8,
  },
  input: {
    borderBottomWidth: 1.5,
    borderBottomColor: "#e0e0dc",
    paddingVertical: 12,
    paddingHorizontal: 4,
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: "#1a1a18",
  },
  inputFocused: { borderBottomColor: "#1a1a18" },
  darkButton: {
    backgroundColor: "#1a1a18",
    borderRadius: 50,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  darkButtonDisabled: { opacity: 0.4 },
  darkButtonText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: "#ffffff",
    letterSpacing: 0.2,
  },
  termsText: {
    fontFamily: "DMSans_300Light",
    fontSize: 11,
    color: "#9a9a95",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 16,
  },
});
