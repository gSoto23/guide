import { setRequestLocale } from "next-intl/server";
import { Uploads } from "@/components/guide/uploads";

/** Manuals and photos (screen H-15, feature 003 US6). */
export default async function UploadsPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <Uploads locale={locale} propertyId={propertyId} />
    </main>
  );
}
