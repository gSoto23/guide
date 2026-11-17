import { setRequestLocale } from "next-intl/server";
import { PropertyListView } from "@/components/properties/property-list";
import { RemovedProperties } from "@/components/properties/removed-properties";

/** Properties of the current workspace (FR-006, T045), or the removed ones (FR-045, T119). */
export default async function PropertiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { locale } = await params;
  const { view } = await searchParams;
  setRequestLocale(locale);
  return (
    <main>
      {view === "removed" ? (
        <RemovedProperties locale={locale} />
      ) : (
        <PropertyListView locale={locale} />
      )}
    </main>
  );
}
