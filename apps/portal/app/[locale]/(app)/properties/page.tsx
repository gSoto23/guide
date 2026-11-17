import { setRequestLocale } from "next-intl/server";
import { PropertyListView } from "@/components/properties/property-list";

/** Properties of the current workspace (FR-006, T045). */
export default async function PropertiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <PropertyListView locale={locale} />
    </main>
  );
}
