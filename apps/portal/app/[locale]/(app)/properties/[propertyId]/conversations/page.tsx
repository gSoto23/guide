import { setRequestLocale } from "next-intl/server";
import { ConversationList } from "@/components/conversations/conversation-list";

/** A property's guest conversations (feature 005 US3). */
export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide">
      <ConversationList locale={locale} propertyId={propertyId} />
    </main>
  );
}
