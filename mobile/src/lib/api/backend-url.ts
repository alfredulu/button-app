import Constants from "expo-constants";
import { Platform } from "react-native";

/** Normalized backend origin (no trailing slash). */
export function getBackendBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").trim().replace(/\/$/, "");
}

/**
 * On a physical device, `localhost` / `127.0.0.1` point at the phone, not the dev machine.
 * Simulators can use localhost; real hardware needs the PC's LAN IP in .env.
 */
export function isPhysicalDeviceUsingLocalhostBackend(): boolean {
  const base = getBackendBaseUrl().toLowerCase();
  if (!base) return false;
  const isLocal = base.includes("localhost") || base.includes("127.0.0.1");
  if (!isLocal) return false;
  if (Platform.OS === "web") return false;
  return Constants.isDevice === true;
}

export function explainBackendConnectionFailure(): string {
  if (isPhysicalDeviceUsingLocalhostBackend()) {
    return (
      "This phone can’t reach your backend at localhost (localhost here is the phone, not your computer). " +
      "Set EXPO_PUBLIC_BACKEND_URL to http://YOUR_PC_LAN_IP:3000 in mobile/.env (same Wi‑Fi), then run npx expo start --clear. " +
      "Keep the backend running on your PC."
    );
  }
  return "Connection error. Please try again.";
}
