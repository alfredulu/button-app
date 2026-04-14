import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { supabase, isSupabaseConfigured } from "@/lib/auth/supabase";
import { useSession } from "@/lib/auth/use-session";
import { setPostSignupPersonalizationPending } from "@/lib/onboarding-flow";

function isEmailNotConfirmedError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { message?: string; code?: string };
  if (o.code === "email_not_confirmed") return true;
  const m = (o.message ?? "").toLowerCase();
  return m.includes("email not confirmed") || m.includes("email_not_confirmed");
}

async function resendConfirmationEmail(address: string) {
  const { error } = await supabase.auth.resend({ type: "signup", email: address });
  if (error) {
    Alert.alert("Could not resend", error.message);
  } else {
    Alert.alert("Email sent", "Check your inbox, spam, and promotions folders.");
  }
}

export default function Onboarding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const { data: sessionData, isLoading: sessionLoading } = useSession();
  const authInFlight = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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
  const passwordOpacity = useSharedValue(0);
  const passwordY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonY = useSharedValue(20);
  const toggleOpacity = useSharedValue(0);
  const toggleY = useSharedValue(20);
  const termsOpacity = useSharedValue(0);
  const termsY = useSharedValue(20);

  // Button press spring scale
  const buttonScale = useSharedValue(1);

  const enterConfig = { duration: 350, easing: Easing.out(Easing.cubic) };

  useEffect(() => {
    const m = params.mode;
    const mode = Array.isArray(m) ? m[0] : m;
    if (mode === "signin") setIsSignUp(false);
    if (mode === "signup") setIsSignUp(true);
  }, [params.mode]);

  useEffect(() => {
    const pairs: Array<[SharedValue<number>, SharedValue<number>, number]> = [
      [logoOpacity, logoY, 0],
      [taglineOpacity, taglineY, 80],
      [ornamentOpacity, ornamentY, 160],
      [modeTitleOpacity, modeTitleY, 260],
      [emailOpacity, emailY, 320],
      [passwordOpacity, passwordY, 380],
      [buttonOpacity, buttonY, 440],
      [toggleOpacity, toggleY, 500],
      [termsOpacity, termsY, 560],
    ];
    const timers: ReturnType<typeof setTimeout>[] = pairs.map(([opacity, y, delay]) =>
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
  const passwordInputStyle = useAnimatedStyle(() => ({
    opacity: passwordOpacity.value,
    transform: [{ translateY: passwordY.value }],
  }));
  const buttonContainerStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonY.value }],
  }));
  const toggleAnimStyle = useAnimatedStyle(() => ({
    opacity: toggleOpacity.value,
    transform: [{ translateY: toggleY.value }],
  }));
  const termsAnimStyle = useAnimatedStyle(() => ({
    opacity: termsOpacity.value,
    transform: [{ translateY: termsY.value }],
  }));
  const btnPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const isDisabled = !email.trim() || !password || loading;

  if (!sessionLoading && sessionData?.user && !authInFlight.current) {
    return <Redirect href="/" />;
  }

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }
    if (!isSupabaseConfigured()) {
      Alert.alert(
        "Supabase not configured",
        "Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to mobile/.env (Supabase → Settings → API), then restart Expo with npx expo start --clear."
      );
      return;
    }

    authInFlight.current = true;
    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
        if (error) throw error;
        if (data.session) {
          await setPostSignupPersonalizationPending(true);
          router.replace("/personalization" as Href);
        } else {
          authInFlight.current = false;
          Alert.alert(
            "Confirm your email",
            "Supabase sent a confirmation link. It can take a few minutes and often lands in spam or promotions.",
            [
              { text: "OK" },
              { text: "Resend email", onPress: () => void resendConfirmationEmail(trimmedEmail) },
            ]
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) {
          if (isEmailNotConfirmedError(error)) {
            authInFlight.current = false;
            Alert.alert(
              "Email not confirmed",
              "Open the link from your signup email first. Check spam/promotions. In Supabase Dashboard you can also turn off “Confirm email” for testing.",
              [
                { text: "OK" },
                { text: "Resend confirmation", onPress: () => void resendConfirmationEmail(trimmedEmail) },
              ]
            );
            return;
          }
          throw error;
        }
        router.replace("/(app)" as Href);
      }
    } catch (e: unknown) {
      authInFlight.current = false;
      if (isEmailNotConfirmedError(e)) {
        Alert.alert(
          "Email not confirmed",
          "Open the link from your signup email first. Check spam/promotions.",
          [
            { text: "OK" },
            { text: "Resend confirmation", onPress: () => void resendConfirmationEmail(trimmedEmail) },
          ]
        );
        return;
      }
      const raw = e instanceof Error ? e.message : String(e);
      const message =
        raw === "Network request failed" || raw.includes("fetch")
          ? "Could not reach Supabase. Check: (1) phone Wi‑Fi, (2) EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env match your project, (3) restart Metro after editing .env."
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
            {isSignUp ? "Create account" : "Welcome back"}
          </Animated.Text>

          <Animated.View style={emailInputStyle}>
            <TextInput
              style={[styles.input, emailFocused && styles.inputFocused]}
              placeholder="Email"
              placeholderTextColor="#9a9a95"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              testID="email-input"
            />
          </Animated.View>

          <Animated.View style={passwordInputStyle}>
            <TextInput
              style={[styles.input, passwordFocused && styles.inputFocused]}
              placeholder="Password"
              placeholderTextColor="#9a9a95"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              onSubmitEditing={handleSubmit}
              testID="password-input"
            />
          </Animated.View>

          <Animated.View style={buttonContainerStyle}>
            <Pressable
              onPressIn={() => {
                if (!isDisabled) {
                  buttonScale.value = withSpring(0.96, { damping: 18, stiffness: 220 });
                }
              }}
              onPressOut={() => {
                buttonScale.value = withSpring(1.0, { damping: 18, stiffness: 220 });
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
                    {isSignUp ? "Create account" : "Sign in"}
                  </Text>
                )}
              </Animated.View>
            </Pressable>
          </Animated.View>

          <Animated.View style={[styles.toggleBtnWrapper, toggleAnimStyle]}>
            <Pressable
              onPress={() => setIsSignUp(!isSignUp)}
              style={styles.toggleBtn}
              testID="toggle-mode"
            >
              <Text style={styles.toggleText}>
                {isSignUp
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Sign up"}
              </Text>
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
    marginBottom: 4,
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
  toggleBtnWrapper: { alignItems: "center" },
  toggleBtn: { paddingVertical: 4 },
  toggleText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: "#9a9a95",
    textDecorationLine: "underline",
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
