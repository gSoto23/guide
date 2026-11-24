import { setRequestLocale } from "next-intl/server";
import { CalendarView } from "@/components/calendar/calendar-view";

/** The stay calendar (feature 018 US1). */
export default async function CalendarPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide">
      <CalendarView locale={locale} />
    </main>
  );
}
