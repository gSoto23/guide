import { setRequestLocale } from "next-intl/server";
import { CopilotView } from "@/components/inbox/copilot-view";

/** The paste-to-reply copilot (feature 006 US3; screen H-22). */
export default async function CopilotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide">
      <CopilotView locale={locale} />
    </main>
  );
}
