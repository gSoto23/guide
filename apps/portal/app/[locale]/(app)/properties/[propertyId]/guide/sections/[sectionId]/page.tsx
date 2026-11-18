import { setRequestLocale } from "next-intl/server";
import { SectionEditor } from "@/components/guide/section-editor";

/** The section editor (screen H-13, feature 003 US1). */
export default async function GuideSectionPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string; sectionId: string }>;
}) {
  const { locale, propertyId, sectionId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <SectionEditor locale={locale} propertyId={propertyId} sectionId={sectionId} />
    </main>
  );
}
