"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { OnboardingResponse } from "@guidesk/contracts";
import { apiFetch } from "@/lib/api";
import { useMe } from "@/lib/use-me";

/**
 * After sign-in: first-time users answer onboarding; returning users go straight to work in the
 * workspace they used last (FR-024), which /me already reports as the current one.
 */
export function StartRedirect({ locale }: { locale: string }) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const me = useMe(locale);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    apiFetch<OnboardingResponse>("/api/v1/me/onboarding")
      .then((onboarding) => {
        if (cancelled) return;
        const done = onboarding.answeredAt !== null || onboarding.skipped;
        router.replace(
          done ? `/${locale}/properties/new?path=${onboarding.path}` : `/${locale}/onboarding`,
        );
      })
      .catch(() => {
        if (!cancelled) router.replace(`/${locale}/onboarding`);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, me, router]);

  return <p className="muted">{t("loading")}</p>;
}
