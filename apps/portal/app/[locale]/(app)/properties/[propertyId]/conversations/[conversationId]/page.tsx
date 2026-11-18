import { setRequestLocale } from "next-intl/server";
import { ConversationView } from "@/components/conversations/conversation-view";

/** One guest conversation (feature 005 US3, H-21 subset). */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string; conversationId: string }>;
}) {
  const { locale, propertyId, conversationId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <ConversationView locale={locale} propertyId={propertyId} conversationId={conversationId} />
    </main>
  );
}
