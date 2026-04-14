import { useEffect, useState } from "react";
import Purchases, { PurchasesPackage, CustomerInfo, LOG_LEVEL } from "react-native-purchases";
import { Platform } from "react-native";

/** Prefer client-supplied names; fall back to legacy Vibecode env names. */
const IOS_KEY = (
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? process.env.EXPO_PUBLIC_VIBECODE_REVENUECAT_APPLE_KEY ??
  ""
).trim();
const ANDROID_KEY = (
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ??
  process.env.EXPO_PUBLIC_VIBECODE_REVENUECAT_GOOGLE_KEY ??
  ""
).trim();
const TEST_KEY = (process.env.EXPO_PUBLIC_VIBECODE_REVENUECAT_TEST_KEY ?? "").trim();

function resolveRevenueCatApiKey(): string | undefined {
  if (__DEV__) {
    if (TEST_KEY) return TEST_KEY;
    if (Platform.OS === "ios" && IOS_KEY) return IOS_KEY;
    if (Platform.OS === "android" && ANDROID_KEY) return ANDROID_KEY;
    return undefined;
  }
  if (Platform.OS === "ios") return IOS_KEY || undefined;
  return ANDROID_KEY || undefined;
}

// Patch console.error at module-load time so it is in place before RevenueCat
// registers its internal log listener (purchases.js:73). The listener calls
// console.error with "Purchase was cancelled" whenever a user dismisses the
// native paywall, which React Native's dev tools intercept and turn into a
// red-screen crash. Filtering the specific messages here prevents that without
// suppressing any real errors. This runs only in __DEV__ builds.
if (__DEV__) {
  const _orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (
      msg.includes("Purchase was cancelled") ||
      msg.includes("userCancelled") ||
      msg.includes("SKErrorDomain") ||
      msg.includes("code: 2")
    ) {
      return;
    }
    _orig(...args);
  };
}

let _rcConfigured = false;

export function configureRevenueCat(userId?: string) {
  const apiKey = resolveRevenueCatApiKey();

  if (!apiKey) {
    if (__DEV__) {
      console.warn(
        "[RevenueCat] Skipping Purchases.configure — set in mobile/.env: EXPO_PUBLIC_VIBECODE_REVENUECAT_TEST_KEY (Expo Go), or EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (public SDK keys from RevenueCat → API keys). Restart Metro after saving."
      );
    }
    return;
  }

  if (!_rcConfigured) {
    Purchases.configure({ apiKey });
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.ERROR);
    }
    _rcConfigured = true;
  }

  if (userId) {
    Purchases.logIn(userId).catch(() => {});
  }
}

export function useRevenueCat() {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [proPackage, setProPackage] = useState<PurchasesPackage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);

  const isPro =
    customerInfo?.entitlements.active["pro"] !== undefined;

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [info, offerings] = await Promise.all([
          Purchases.getCustomerInfo(),
          Purchases.getOfferings(),
        ]);
        if (!mounted) return;
        setCustomerInfo(info);
        const monthly = offerings.current?.monthly ?? null;
        setProPackage(monthly);
      } catch {
        // silently fail — treat as free
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();

    const listener = (info: CustomerInfo) => {
      if (mounted) setCustomerInfo(info);
    };
    Purchases.addCustomerInfoUpdateListener(listener);

    return () => {
      mounted = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  const purchasePro = async (): Promise<boolean> => {
    if (!proPackage) return false;
    setIsPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(proPackage);
      setCustomerInfo(customerInfo);
      return customerInfo.entitlements.active["pro"] !== undefined;
    } catch (e: any) {
      if (!e.userCancelled) throw e;
      return false;
    } finally {
      setIsPurchasing(false);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    setIsPurchasing(true);
    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      return info.entitlements.active["pro"] !== undefined;
    } finally {
      setIsPurchasing(false);
    }
  };

  return {
    customerInfo,
    proPackage,
    isLoading,
    isPurchasing,
    isPro,
    purchasePro,
    restorePurchases,
  };
}
