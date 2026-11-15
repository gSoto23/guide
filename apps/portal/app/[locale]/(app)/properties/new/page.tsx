import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { FirstProperty } from "@/components/first-property";

/** Handoff to feature 002 (property onboarding), T045. */
export default async function NewPropertyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <Suspense>
        <FirstProperty locale={locale} />
      </Suspense>
    </main>
  );
}
