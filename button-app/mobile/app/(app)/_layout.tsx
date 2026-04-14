import React, { useEffect } from "react";
import { Redirect, Tabs } from "expo-router";
import { Pressable, StyleSheet, GestureResponderEvent } from "react-native";
import { useSession } from "@/lib/auth/use-session";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Mic, List, UserRound, Settings } from "lucide-react-native";

type TabIconProps = {
  icon: React.ReactNode;
  label: string;
  focused: boolean;
  onPress: (e: GestureResponderEvent) => void;
  onLongPress: (e: GestureResponderEvent) => void;
  testID?: string;
};

function AnimatedTabButton({
  icon,
  label,
  focused,
  onPress,
  onLongPress,
  testID,
}: TabIconProps) {
  const scale = useSharedValue(focused ? 1.15 : 1.0);
  const labelOpacity = useSharedValue(focused ? 1 : 0.6);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
  }));

  useEffect(() => {
    scale.value = withSpring(focused ? 1.15 : 1.0, { damping: 18, stiffness: 220 });
    labelOpacity.value = withTiming(focused ? 1 : 0.6, { duration: 150, easing: Easing.out(Easing.cubic) });
  }, [focused]);

  return (
    <Pressable
      onPress={(e) => {
        scale.value = withSpring(1.0, { damping: 18, stiffness: 220 });
        setTimeout(() => {
          scale.value = withSpring(1.15, { damping: 18, stiffness: 220 });
        }, 60);
        labelOpacity.value = withTiming(1, { duration: 150 });
        onPress(e);
      }}
      onLongPress={onLongPress}
      style={styles.tabButton}
      testID={testID}
    >
      <Animated.View style={[styles.iconWrapper, animStyle]}>{icon}</Animated.View>
      <Animated.Text
        style={[styles.tabLabel, { color: focused ? "#1a1a18" : "#9a9a95" }, labelStyle]}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

export default function AppTabsLayout() {
  const { data: session, isLoading } = useSession();
  if (isLoading) return null;
  if (!session?.user) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e0e0dc",
          borderTopWidth: 1,
          height: 88,
          paddingBottom: 0,
          paddingTop: 0,
        },
        tabBarActiveTintColor: "#1a1a18",
        tabBarInactiveTintColor: "#9a9a95",
        tabBarLabelStyle: {
          fontFamily: "DMSans_400Regular",
          fontSize: 11,
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarButton: (props) => (
            <AnimatedTabButton
              icon={
                <Mic
                  size={22}
                  color={props.accessibilityState?.selected ? "#1a1a18" : "#9a9a95"}
                  strokeWidth={1.5}
                />
              }
              label="Home"
              focused={props.accessibilityState?.selected ?? false}
              onPress={props.onPress ?? (() => {})}
              onLongPress={props.onLongPress ?? (() => {})}
              testID="tab-home"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarButton: (props) => (
            <AnimatedTabButton
              icon={
                <List
                  size={22}
                  color={props.accessibilityState?.selected ? "#1a1a18" : "#9a9a95"}
                  strokeWidth={1.5}
                />
              }
              label="History"
              focused={props.accessibilityState?.selected ?? false}
              onPress={props.onPress ?? (() => {})}
              onLongPress={props.onLongPress ?? (() => {})}
              testID="tab-history"
            />
          ),
        }}
      />
      <Tabs.Screen name="pricing" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarButton: (props) => (
            <AnimatedTabButton
              icon={
                <UserRound
                  size={22}
                  color={props.accessibilityState?.selected ? "#1a1a18" : "#9a9a95"}
                  strokeWidth={1.5}
                />
              }
              label="Profile"
              focused={props.accessibilityState?.selected ?? false}
              onPress={props.onPress ?? (() => {})}
              onLongPress={props.onLongPress ?? (() => {})}
              testID="tab-profile"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarButton: (props) => (
            <AnimatedTabButton
              icon={
                <Settings
                  size={22}
                  color={props.accessibilityState?.selected ? "#1a1a18" : "#9a9a95"}
                  strokeWidth={1.5}
                />
              }
              label="Settings"
              focused={props.accessibilityState?.selected ?? false}
              onPress={props.onPress ?? (() => {})}
              onLongPress={props.onLongPress ?? (() => {})}
              testID="tab-settings"
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 10,
    paddingBottom: 0,
    gap: 3,
    height: 88,
  },
  iconWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
