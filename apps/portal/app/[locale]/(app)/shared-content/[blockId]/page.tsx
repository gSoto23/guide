import { setRequestLocale } from "next-intl/server";
import { BlockEditor } from "@/components/shared-content/block-editor";

/** One shared block (screen H-29, feature 003 US7). */
export default async function SharedBlockPage({
  params,
}: {
  params: Promise<{ locale: string; blockId: string }>;
}) {
  const { locale, blockId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <BlockEditor locale={locale} blockId={blockId} />
    </main>
  );
}
