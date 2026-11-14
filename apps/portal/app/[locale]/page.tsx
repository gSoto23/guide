import { use } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("app");
  const auth = useTranslations("auth");

  return (
    <main>
      <h1>{t("name")}</h1>
      <p className="muted">{t("tagline")}</p>
      <Link className="button button-primary" href={`/${locale}/sign-in`}>
        {auth("signInCta")}
      </Link>
    </main>
  );
}
