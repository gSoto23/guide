import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { ImportProgressBanner } from "@/components/properties/import-progress-banner";
import { MeProvider } from "@/lib/me-context";

/** Signed-in screens share the user, the current workspace, and the header (US4). */
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
      <AppHeader locale={locale} />
      <ImportProgressBanner locale={locale} />
      {children}
    </MeProvider>
  );
}
