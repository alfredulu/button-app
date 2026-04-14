import React from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { router } from "expo-router";
import RevenueCatUI from "react-native-purchases-ui";

function PaywallUnavailable({ title, body }: { title: string; body: string }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export default function PricingScreen() {
  if (Platform.OS === "web") {
    return (
      <PaywallUnavailable
        title="Subscriptions in the app only"
        body="Apple and Google purchases are not available in the browser preview. Open the project in Expo Go or a dev build on iOS/Android to use the real paywall."
      />
    );
  }

  if (Constants.appOwnership === "expo") {
    return (
      <PaywallUnavailable
        title="Preview in Expo Go"
        body="RevenueCat shows a limited preview here. Real purchases and the full paywall need an iOS/Android development build or a store build (EAS Build / Xcode / Android Studio), not Expo Go alone."
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <RevenueCatUI.Paywall
        onDismiss={() => router.back()}
        onPurchaseCompleted={() => {
          Alert.alert("Welcome to Pro!");
          router.back();
        }}
        onPurchaseCancelled={() => {}}
        onPurchaseError={() => {
          Alert.alert("Purchase failed. Please try again.");
        }}
        onRestoreCompleted={() => {
          Alert.alert("Purchases restored!");
        }}
        onRestoreError={() => {
          Alert.alert("Restore failed. Please try again.");
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  center: { flex: 1, padding: 24, justifyContent: "center" },
  title: {
    color: "#f5f5f0",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  body: {
    color: "#a3a39a",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: "#e8e8e0",
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  buttonText: { color: "#111", fontSize: 16, fontWeight: "600" },
});
