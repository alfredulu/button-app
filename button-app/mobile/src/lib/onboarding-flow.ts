import AsyncStorage from "@react-native-async-storage/async-storage";

/** Shown only on first launch; set true when user leaves slide 5 for auth. */
export const STORAGE_ONBOARDING_COMPLETE = "onboarding_complete";

/** After sign-up with an immediate session — show personalization then notification prompt. */
export const STORAGE_POST_SIGNUP_PERSONALIZATION = "post_signup_personalization_pending";

export const STORAGE_POST_SIGNUP_NOTIFICATION = "post_signup_notification_pending";

export async function getIntroOnboardingComplete(): Promise<boolean> {
  const v = await AsyncStorage.getItem(STORAGE_ONBOARDING_COMPLETE);
  return v === "true";
}

export async function setIntroOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_ONBOARDING_COMPLETE, "true");
}

export async function getPostSignupPersonalizationPending(): Promise<boolean> {
  const v = await AsyncStorage.getItem(STORAGE_POST_SIGNUP_PERSONALIZATION);
  return v === "true";
}

export async function setPostSignupPersonalizationPending(pending: boolean): Promise<void> {
  if (pending) {
    await AsyncStorage.setItem(STORAGE_POST_SIGNUP_PERSONALIZATION, "true");
  } else {
    await AsyncStorage.removeItem(STORAGE_POST_SIGNUP_PERSONALIZATION);
  }
}

export async function getPostSignupNotificationPending(): Promise<boolean> {
  const v = await AsyncStorage.getItem(STORAGE_POST_SIGNUP_NOTIFICATION);
  return v === "true";
}

export async function setPostSignupNotificationPending(pending: boolean): Promise<void> {
  if (pending) {
    await AsyncStorage.setItem(STORAGE_POST_SIGNUP_NOTIFICATION, "true");
  } else {
    await AsyncStorage.removeItem(STORAGE_POST_SIGNUP_NOTIFICATION);
  }
}

export type OnboardingDataPayload = {
  planning_time: "morning" | "midday" | "evening" | "varies";
  user_type: "professional" | "student" | "parent" | "founder";
  struggle: "forgetting" | "no_reminders" | "manual_entry" | "dont_plan";
};
