"use client";

import { useEffect, useState, type ComponentType } from "react";

type Banner = ComponentType<{ locale: string }>;

/**
 * Loads the AI usage banner after the page with a plain dynamic import, keeping its code out of
 * every route's initial JavaScript (feature 011 research R9).
 */
export function PlanUsageBannerLoader({ locale }: { locale: string }) {
  const [Loaded, setLoaded] = useState<Banner | null>(null);
  useEffect(() => {
    let active = true;
    void import("./plan-usage-banner").then((module) => {
      if (active) setLoaded(() => module.PlanUsageBanner);
    });
    return () => {
      active = false;
    };
  }, []);
  return Loaded ? <Loaded locale={locale} /> : null;
}
