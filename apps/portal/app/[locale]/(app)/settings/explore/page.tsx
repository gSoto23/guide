import { setRequestLocale } from "next-intl/server";
import { WorkspaceExploreSettings } from "@/components/explore/workspace-explore";

/** The workspace default for Explore (feature 009 FR-021). */
export default async function WorkspaceExplorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <WorkspaceExploreSettings />
    </main>
  );
}
