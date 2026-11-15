import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { VerifyCodeForm } from "@/components/verify-code-form";

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <Suspense>
        <VerifyCodeForm locale={locale} />
      </Suspense>
    </main>
  );
}
