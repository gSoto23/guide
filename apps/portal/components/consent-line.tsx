import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Feature 014 FR-009: continuing on sign-in or an invitation accepts the terms and the privacy
 * policy. Server component; the links open the documents in the same language.
 */
export async function ConsentLine({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <p className="consent-line">
      {t.rich("consent", {
        terms: (chunks) => <Link href={`/${locale}/terms`}>{chunks}</Link>,
        privacy: (chunks) => <Link href={`/${locale}/privacy`}>{chunks}</Link>,
      })}
    </p>
  );
}
