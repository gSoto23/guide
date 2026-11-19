import { setRequestLocale } from "next-intl/server";
import { PayoutsView } from "@/components/payments/payouts-view";

/** Payouts (feature 013 US2; screen H-33). */
export default async function PayoutsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <PayoutsView locale={locale} />
    </main>
  );
}
