import { setRequestLocale } from "next-intl/server";
import { StayView } from "@/components/calendar/stay-view";

/** One stay with its guest, link, conversations, and add-ons (feature 018 US2). */
export default async function StayPage({
  params,
}: {
  params: Promise<{ locale: string; stayId: string }>;
}) {
  const { locale, stayId } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide">
      <StayView locale={locale} stayId={stayId} />
    </main>
  );
}
