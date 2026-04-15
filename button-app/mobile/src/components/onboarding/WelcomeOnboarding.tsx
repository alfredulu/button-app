import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import PagerView from "react-native-pager-view";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Mic, Calendar, Check } from "lucide-react-native";
import { useRouter, type Href } from "expo-router";
import { setIntroOnboardingComplete } from "@/lib/onboarding-flow";

const INK = "#1a1a18";
const MUTED = "#9a9a95";
const DOT_INACTIVE = "#e0e0dc";
const PILL_BG = "#f0f0ee";
const SOFT_BG = "#f7f7f5";

const SLIDE_COUNT = 5;

function useSlideEnter(isActive: boolean) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(14);

  useEffect(() => {
    if (!isActive) {
      opacity.value = 0;
      translateY.value = 14;
      return;
    }
    const t = setTimeout(() => {
      opacity.value = withTiming(1, {
        duration: 420,
        easing: Easing.out(Easing.cubic),
      });
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    }, 150);
    return () => clearTimeout(t);
  }, [isActive, opacity, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

function SlideBottom({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const anim = useSlideEnter(active);
  return (
    <Animated.View style={[anim, { width: "100%", alignItems: "center" }]}>
      {children}
    </Animated.View>
  );
}

function PulseRing({ delayMs }: { delayMs: number }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    const t = setTimeout(() => {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.55, { duration: 2400, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 0 })
        ),
        -1,
        false
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 2400, easing: Easing.out(Easing.quad) }),
          withTiming(0.45, { duration: 0 })
        ),
        -1,
        false
      );
    }, delayMs);
    return () => clearTimeout(t);
  }, [delayMs, opacity, scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        { alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      <View
        style={{
          width: 200,
          height: 200,
          borderRadius: 100,
          borderWidth: 2,
          borderColor: INK,
        }}
      />
    </Animated.View>
  );
}

function Slide1Illustration() {
  return (
    <View style={illustrationStyles.wrap}>
      <View
        style={[illustrationStyles.softPanel, { backgroundColor: SOFT_BG }]}
      >
        <PulseRing delayMs={0} />
        <PulseRing delayMs={800} />
        <PulseRing delayMs={1600} />
        <View
          style={{
            width: 200,
            height: 200,
            borderRadius: 100,
            backgroundColor: INK,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Mic color="#ffffff" size={72} strokeWidth={1.5} />
        </View>
      </View>
    </View>
  );
}

function WaveBar({ h, delay }: { h: number; delay: number }) {
  const scaleY = useSharedValue(0.35);

  useEffect(() => {
    const t = setTimeout(() => {
      scaleY.value = withRepeat(
        withSequence(
          withTiming(1, {
            duration: 280 + Math.random() * 120,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.35, {
            duration: 280 + Math.random() * 120,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        true
      );
    }, delay);
    return () => clearTimeout(t);
  }, [delay, scaleY]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: 4,
          height: h,
          borderRadius: 2,
          backgroundColor: INK,
          marginHorizontal: 2,
        },
        style,
      ]}
    />
  );
}

function Slide2Illustration() {
  const glow = useSharedValue(0.85);
  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900 }),
        withTiming(0.85, { duration: 900 })
      ),
      -1,
      true
    );
  }, [glow]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.98 + glow.value * 0.04 }],
  }));

  return (
    <View style={illustrationStyles.wrap}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 20 }}>
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 112,
              height: 168,
              borderRadius: 18,
              borderWidth: 3,
              borderColor: INK,
              backgroundColor: "#fafafa",
              paddingTop: 14,
              alignItems: "center",
            }}
          >
            <Animated.View style={glowStyle}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: "#c42b2b",
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: "#ff2d2d",
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.85,
                  shadowRadius: 16,
                  elevation: 12,
                }}
              >
                <Mic color="#fff" size={26} strokeWidth={1.5} />
              </View>
            </Animated.View>
          </View>
          <View
            style={{
              marginTop: -6,
              width: 44,
              height: 14,
              borderRadius: 7,
              backgroundColor: PILL_BG,
            }}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: 80,
            marginBottom: 28,
          }}
        >
          {[24, 36, 20, 44, 28, 40, 18, 32].map((h, i) => (
            <WaveBar key={i} h={h} delay={i * 80} />
          ))}
        </View>
      </View>
    </View>
  );
}

function MiniEventCard({
  title,
  subtitle,
  delay,
  active,
}: {
  title: string;
  subtitle: string;
  delay: number;
  active: boolean;
}) {
  const opacity = useSharedValue(0);
  const ty = useSharedValue(16);

  useEffect(() => {
    if (!active) {
      opacity.value = 0;
      ty.value = 16;
      return;
    }
    const t = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 340 });
      ty.value = withSpring(0, { damping: 18, stiffness: 200 });
    }, 150 + delay);
    return () => clearTimeout(t);
  }, [active, delay, opacity, ty]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          backgroundColor: "#f9f9f7",
          borderRadius: 12,
          padding: 12,
          marginBottom: 8,
          width: "100%",
          maxWidth: 280,
        },
        cardStyle,
      ]}
    >
      <Text
        style={{
          fontFamily: "DMSans_500Medium",
          fontSize: 14,
          color: INK,
          marginBottom: 2,
        }}
      >
        {title}
      </Text>
      <Text
        style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: MUTED }}
      >
        {subtitle}
      </Text>
    </Animated.View>
  );
}

function GoogleCalendarMark({
  showCheck,
  active,
}: {
  showCheck: boolean;
  active: boolean;
}) {
  const checkScale = useSharedValue(0);
  useEffect(() => {
    if (!active || !showCheck) {
      checkScale.value = 0;
      return;
    }
    const t = setTimeout(() => {
      checkScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    }, 900);
    return () => clearTimeout(t);
  }, [active, showCheck, checkScale]);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkScale.value,
  }));

  return (
    <View style={{ alignItems: "center", marginTop: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: DOT_INACTIVE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Calendar size={20} color={INK} strokeWidth={1.5} />
        </View>
        <Text
          style={{ fontFamily: "DMSans_500Medium", fontSize: 14, color: INK }}
        >
          Google Calendar
        </Text>
      </View>
      {showCheck ? (
        <Animated.View
          style={[
            {
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "#2ecc71",
              alignItems: "center",
              justifyContent: "center",
            },
            checkStyle,
          ]}
        >
          <Check color="#fff" size={18} strokeWidth={2.5} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function Slide3Illustration({ active }: { active: boolean }) {
  const [showCheck, setShowCheck] = useState(false);
  useEffect(() => {
    if (!active) {
      setShowCheck(false);
      return;
    }
    const t = setTimeout(() => setShowCheck(true), 700);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <View style={[illustrationStyles.wrap, { alignItems: "center" }]}>
      <MiniEventCard
        active={active}
        delay={0}
        title="Dentist Appointment"
        subtitle="Tomorrow 2:00 PM"
      />
      <MiniEventCard
        active={active}
        delay={140}
        title="Team Call"
        subtitle="Tomorrow 4:00 PM"
      />
      <MiniEventCard
        active={active}
        delay={280}
        title="Dinner with Sarah"
        subtitle="Friday 7:00 PM"
      />
      <GoogleCalendarMark showCheck={showCheck} active={active} />
    </View>
  );
}

function Slide4Illustration() {
  return (
    <View style={illustrationStyles.wrap}>
      <View style={{ width: "100%", maxWidth: 300, alignItems: "center" }}>
        <View
          style={{
            alignSelf: "stretch",
            backgroundColor: "#e9e9eb",
            borderRadius: 18,
            padding: 10,
            paddingBottom: 14,
          }}
        >
          <View style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
            <View
              style={{
                backgroundColor: "#007aff",
                borderRadius: 18,
                borderBottomLeftRadius: 4,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text
                style={{
                  fontFamily: "DMSans_400Regular",
                  fontSize: 15,
                  color: "#fff",
                }}
              >
                📅 Hey — Dentist in 1 hour. You've got this 👊
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "DMSans_300Light",
                fontSize: 11,
                color: MUTED,
                marginTop: 4,
                marginLeft: 8,
              }}
            >
              Button
            </Text>
          </View>
        </View>
        <View
          style={{
            marginTop: 28,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: PILL_BG,
            paddingHorizontal: 20,
            paddingVertical: 12,
            borderRadius: 999,
          }}
        >
          <Text style={{ fontSize: 22 }}>🔥</Text>
          <Text
            style={{
              fontFamily: "DMSerifDisplay_400Regular",
              fontSize: 22,
              color: INK,
            }}
          >
            7
          </Text>
          <Text
            style={{
              fontFamily: "DMSans_400Regular",
              fontSize: 14,
              color: INK,
            }}
          >
            7-day streak
          </Text>
        </View>
      </View>
    </View>
  );
}

const ORBIT_ICONS = ["🌟", "🏆", "✨", "🎯", "💎"];

function Slide5Illustration() {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 28000, easing: Easing.linear }),
      -1,
      false
    );
  }, [rotation]);

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const R = 118;
  const box = R * 2 + 80;
  return (
    <View
      style={[
        illustrationStyles.wrap,
        { position: "relative", width: box, height: box },
      ]}
    >
      <Animated.View
        style={[
          { position: "absolute", width: box, height: box, left: 0, top: 0 },
          orbitStyle,
        ]}
      >
        {ORBIT_ICONS.map((emoji, i) => {
          const angle = (Math.PI * 2 * i) / ORBIT_ICONS.length - Math.PI / 2;
          const x = Math.cos(angle) * R;
          const y = Math.sin(angle) * R;
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: box / 2 + x - 18,
                top: box / 2 + y - 18,
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: PILL_BG,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 18 }}>{emoji}</Text>
            </View>
          );
        })}
      </Animated.View>
      <View
        style={{
          position: "absolute",
          left: box / 2 - 80,
          top: box / 2 - 80,
          width: 160,
          height: 160,
          borderRadius: 80,
          backgroundColor: INK,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Mic color="#ffffff" size={56} strokeWidth={1.5} />
      </View>
    </View>
  );
}

const illustrationStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    minHeight: 200,
  },
  softPanel: {
    width: 280,
    height: 280,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default function WelcomeOnboarding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<PagerView>(null);
  const [page, setPage] = useState(0);

  const goAuth = useCallback(
    async (mode: "signup" | "signin") => {
      await setIntroOnboardingComplete();
      router.replace(
        (mode === "signin"
          ? "/onboarding?mode=signin"
          : "/onboarding?mode=signup") as Href
      );
    },
    [router]
  );

  const skipToLast = useCallback(() => {
    pagerRef.current?.setPage(4);
    setPage(4);
  }, []);

  const onPageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setPage(e.nativeEvent.position);
    },
    []
  );

  const isLastPage = page === SLIDE_COUNT - 1;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        {!isLastPage ? (
          <Pressable onPress={skipToLast} style={styles.skipBtn} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.skipSpacer} />
        )}
      </View>

      <PagerView
        ref={pagerRef}
        style={{ flex: 1, width }}
        initialPage={0}
        onPageSelected={onPageSelected}
        overdrag
      >
        <View key="0" style={styles.page}>
          <View style={styles.topZone}>
            <Slide1Illustration />
          </View>
          <View style={styles.bottomZone}>
            <SlideBottom active={page === 0}>
              <Text style={styles.headline}>Meet Button.</Text>
              <Text style={styles.body}>
                The fastest way to plan your day. No typing. No tapping. Just
                your voice.
              </Text>
              <Text style={styles.hintItalic}>Swipe to see how it works →</Text>
            </SlideBottom>
          </View>
        </View>

        <View key="1" style={styles.page}>
          <View style={styles.topZone}>
            <Slide2Illustration />
          </View>
          <View style={styles.bottomZone}>
            <SlideBottom active={page === 1}>
              <Text style={styles.headline}>Hold. Speak. Done.</Text>
              <Text style={styles.body}>
                Hold the button and speak your plans out loud. Say anything —
                "dentist tomorrow at 2, team call at 4, dinner Friday at 7" —
                and Button understands all of it.
              </Text>
              <View style={styles.pillRow}>
                {["🎤 Press", "🗣️ Speak", "⚡ Done"].map((label) => (
                  <View key={label} style={styles.stepPill}>
                    <Text style={styles.stepPillText}>{label}</Text>
                  </View>
                ))}
              </View>
            </SlideBottom>
          </View>
        </View>

        <View key="2" style={styles.page}>
          <View style={styles.topZone}>
            <Slide3Illustration active={page === 2} />
          </View>
          <View style={styles.bottomZone}>
            <SlideBottom active={page === 2}>
              <Text style={styles.headline}>Every event. Instantly.</Text>
              <Text style={styles.body}>
                Button pulls out every event from what you said and adds them
                all to your Google Calendar in one tap. No copying. No switching
                apps.
              </Text>
            </SlideBottom>
          </View>
        </View>

        <View key="3" style={styles.page}>
          <View style={styles.topZone}>
            <Slide4Illustration />
          </View>
          <View style={styles.bottomZone}>
            <SlideBottom active={page === 3}>
              <Text style={styles.headline}>Never forget. Never miss.</Text>
              <Text style={styles.body}>
                Button texts you before every event so you're always prepared.
                And your daily planning streak keeps you consistent — one day at
                a time.
              </Text>
              <Text style={styles.smallNote}>
                SMS reminders available on Pro plan
              </Text>
            </SlideBottom>
          </View>
        </View>

        {/* Last slide: ScrollView so buttons are never clipped on small screens */}
        <View key="4" style={styles.page}>
          <View style={styles.topZone}>
            <Slide5Illustration />
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.lastSlideScroll}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <SlideBottom active={page === 4}>
              <Text style={styles.headlineLarge}>
                Give it a try. It's free.
              </Text>
              <Text style={styles.body}>
                Plan up to 3 days a week for free. No credit card. No
                commitment. Just a better way to plan your life.
              </Text>
              <Pressable
                onPress={() => void goAuth("signup")}
                style={({ pressed }) => [
                  styles.ctaPrimary,
                  pressed && { opacity: 0.92 },
                ]}
              >
                <Text style={styles.ctaPrimaryText}>
                  Get Started — It's Free
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void goAuth("signin")}
                style={styles.ctaSecondaryWrap}
              >
                <Text style={styles.ctaSecondary}>
                  Already have an account? Sign in
                </Text>
              </Pressable>
            </SlideBottom>
          </ScrollView>
        </View>
      </PagerView>

      {/* Dots row */}
      <View style={styles.bottomBar}>
        <View style={styles.dots}>
          {Array.from({ length: SLIDE_COUNT }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === page ? INK : DOT_INACTIVE },
              ]}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  topBar: {
    height: 44,
    paddingHorizontal: 20,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  skipSpacer: { height: 36 },
  skipText: { fontFamily: "DMSans_400Regular", fontSize: 15, color: MUTED },
  page: { flex: 1 },
  topZone: {
    flex: 0.55,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  bottomZone: {
    flex: 0.45,
    paddingHorizontal: 28,
    paddingBottom: 24,
    justifyContent: "flex-start",
  },
  lastSlideScroll: {
    paddingHorizontal: 28,
    paddingBottom: 24,
    alignItems: "center",
  },
  headline: {
    fontFamily: "DMSerifDisplay_400Regular",
    fontSize: 36,
    color: INK,
    marginBottom: 14,
    letterSpacing: -0.5,
  },
  headlineLarge: {
    fontFamily: "DMSerifDisplay_400Regular",
    fontSize: 40,
    color: INK,
    marginBottom: 14,
    letterSpacing: -0.5,
  },
  body: {
    fontFamily: "DMSans_300Light",
    fontSize: 17,
    lineHeight: 26,
    color: MUTED,
    textAlign: "center",
    maxWidth: 300,
    alignSelf: "center",
    marginBottom: 12,
  },
  hintItalic: {
    fontFamily: "DMSans_300Light_Italic",
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
    marginTop: 8,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  stepPill: {
    backgroundColor: PILL_BG,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  stepPillText: { fontFamily: "DMSans_400Regular", fontSize: 12, color: INK },
  smallNote: {
    fontFamily: "DMSans_300Light",
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
    marginTop: 6,
  },
  ctaPrimary: {
    backgroundColor: INK,
    borderRadius: 999,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    width: "100%",
    maxWidth: 340,
    alignSelf: "center",
  },
  ctaPrimaryText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: "#ffffff",
  },
  ctaSecondaryWrap: { marginTop: 14, paddingVertical: 6 },
  ctaSecondary: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: MUTED,
    textAlign: "center",
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 18,
    position: "relative",
  },
  dots: {
    flexDirection: "row",
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
