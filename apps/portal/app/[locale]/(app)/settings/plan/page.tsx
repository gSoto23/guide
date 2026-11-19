import { setRequestLocale } from "next-intl/server";
import { PlanView } from "@/components/plan/plan-view";

/** Plan and limits (feature 011 US4; screen H-32). */
export default async function PlanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <PlanView locale={locale} />
    </main>
  );
}
