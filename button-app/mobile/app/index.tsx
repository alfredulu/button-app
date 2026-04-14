import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import type { Href } from "expo-router";
import { useSession } from "@/lib/auth/use-session";
import {
  getIntroOnboardingComplete,
  getPostSignupNotificationPending,
  getPostSignupPersonalizationPending,
} from "@/lib/onboarding-flow";

export default function Index() {
  const { data: session, isLoading } = useSession();
  const [href, setHref] = useState<Href | null>(null);

  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;
    void (async () => {
      const user = session?.user;
      if (!user) {
        const introDone = await getIntroOnboardingComplete();
        if (!cancelled) setHref((introDone ? "/onboarding" : "/welcome") as Href);
        return;
      }
      if (await getPostSignupPersonalizationPending()) {
        if (!cancelled) setHref("/personalization" as Href);
        return;
      }
      if (await getPostSignupNotificationPending()) {
        if (!cancelled) setHref("/notification-prompt" as Href);
        return;
      }
      if (!cancelled) setHref("/(app)" as Href);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, session]);

  if (isLoading || href === null) return null;
  return <Redirect href={href} />;
}
