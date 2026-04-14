import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "@/lib/useColorScheme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useSession } from "@/lib/auth/use-session";
import { configureRevenueCat } from "@/lib/revenue-cat";
import {
  useFonts,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
} from "@expo-google-fonts/playfair-display";
import {
  DMSans_300Light,
  DMSans_300Light_Italic,
  DMSans_400Regular,
  DMSans_500Medium,
} from "@expo-google-fonts/dm-sans";
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display";
import { setupNotificationForegroundHandler } from "@/lib/notifications";

SplashScreen.preventAutoHideAsync();
setupNotificationForegroundHandler();

const queryClient = new QueryClient();

function RootLayoutNav({
  colorScheme,
}: {
  colorScheme: "light" | "dark" | null | undefined;
}) {
  const { data: session, isLoading } = useSession();

  useEffect(() => {
    configureRevenueCat(session?.user?.id);
  }, [session?.user?.id]);

  if (isLoading) return null;

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#ffffff" },
          animation: "fade",
          animationDuration: 260,
        }}
      >
        <Stack.Screen name="index" options={{ animation: "none" }} />
        <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="personalization" options={{ gestureEnabled: false }} />
        <Stack.Screen name="notification-prompt" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(app)" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    DMSans_300Light,
    DMSans_300Light_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSerifDisplay_400Regular,
  });

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView
        style={{ flex: 1 }}
        onLayout={() => SplashScreen.hideAsync()}
      >
        <KeyboardProvider>
          <StatusBar style="dark" />
          <RootLayoutNav colorScheme={colorScheme} />
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
