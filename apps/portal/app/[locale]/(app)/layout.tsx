import type { ReactNode } from "react";
import {
  bag,
  calendar,
  chart,
  house,
  Icon,
  inbox,
  layers,
  more,
  people,
  sliders,
} from "@guidesk/ui";
import { AppHeader, type ShellIcons } from "@/components/app-header";
import { PlanUsageBannerLoader } from "@/components/plan/plan-usage-banner-loader";
import { ImportProgressBanner } from "@/components/properties/import-progress-banner";
import { MeProvider } from "@/lib/me-context";

/** The navigation icons, rendered here on the server (feature 015 research R3). */
const ICONS: ShellIcons = {
  inbox: <Icon data={inbox} size={22} />,
  requests: <Icon data={bag} size={22} />,
  properties: <Icon data={house} size={22} />,
  calendar: <Icon data={calendar} size={22} />,
  analytics: <Icon data={chart} size={22} />,
  shared: <Icon data={layers} size={22} />,
  team: <Icon data={people} size={22} />,
  settings: <Icon data={sliders} size={22} />,
  more: <Icon data={more} size={22} />,
};

/** Signed-in screens share the user, the current workspace, and the shell (US4; feature 015 US1). */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <MeProvider locale={locale}>
      <div className="app-shell">
        <AppHeader locale={locale} icons={ICONS} />
        <div className="app-content">
          <ImportProgressBanner locale={locale} />
          <PlanUsageBannerLoader locale={locale} />
          {children}
        </div>
      </div>
    </MeProvider>
  );
}
