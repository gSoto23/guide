import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  agentDraft,
  agentTrace,
  chatMessage,
  conversation,
  createGuideForProperty,
  guide,
  guideVersion,
  membership,
  property,
  restrictedValue,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { FakeLlmAdapter, type EmailMessage, type FakeLlmOptions } from "@guidesk/integrations";
import { runChatReply, type ChatReplyDeps } from "../../src/jobs/chat-reply.js";

/**
 * Fixtures for the reply job's tests (feature 005): a workspace with an owner and an agent, a
 * published guide whose locked fields are labels only, and one guest conversation. Fictional data.
 */
let handle: DbHandle;

export function useChatDb(value: DbHandle): void {
  handle = value;
}

const doc = (text: string, fieldId?: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text },
        ...(fieldId ? [{ type: "lockedField", attrs: { fieldId } }] : []),
      ],
    },
  ],
});

export interface Seeded {
  workspaceId: string;
  propertyId: string;
  conversationId: string;
  versionId: string;
  sections: Record<string, string>;
  ownerEmail: string;
  agentEmail: string;
}

export async function seed(
  options: { autonomy?: "draft" | "auto"; propertyLimit?: number } = {},
): Promise<Seeded> {
  const db = handle.db;
  const ownerId = `owner-${randomUUID()}`;
  const agentId = `agent-${randomUUID()}`;
  const workspaceId = randomUUID();
  await db.insert(user).values([
    { id: ownerId, name: "Ana", email: `${ownerId}@example.com` },
    { id: agentId, name: "Beto", email: `${agentId}@example.com`, preferredLanguage: "en" },
  ]);
  await db.insert(workspace).values({
    id: workspaceId,
    name: "Hospedajes Ana",
    createdBy: ownerId,
    assistantAutonomy: options.autonomy ?? "draft",
    ...(options.propertyLimit !== undefined
      ? { chatPropertyDailyLimit: options.propertyLimit }
      : {}),
  });
  await db.insert(membership).values([
    { workspaceId, userId: ownerId, role: "owner" },
    { workspaceId, userId: agentId, role: "agent" },
  ]);
  const [prop] = await db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa Colibrí",
      guideLanguages: ["es", "en"],
      setupStatus: "ready",
      source: "manual",
      createdBy: ownerId,
      country: "CR",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
    })
    .returning({ id: property.id });
  const propertyId = prop!.id;
  const { guideId } = await createGuideForProperty(db, {
    workspaceId,
    propertyId,
    guideLanguages: ["es", "en"],
  });
  const [lockbox] = await db
    .insert(restrictedValue)
    .values({
      workspaceId,
      propertyId,
      kind: "lockbox_code",
      label: "Caja de llaves",
      source: "host",
    })
    .returning({ id: restrictedValue.id });
  const [wifi] = await db
    .insert(restrictedValue)
    .values({
      workspaceId,
      propertyId,
      kind: "wifi_password",
      label: "Clave del wifi",
      source: "host",
    })
    .returning({ id: restrictedValue.id });
  const sections = {
    arrival: randomUUID(),
    wifi: randomUUID(),
    checkout: randomUUID(),
    house_rules: randomUUID(),
    emergency: randomUUID(),
  };
  const item = (text: string, fieldId?: string) => ({
    id: randomUUID(),
    kind: "text",
    sourceLanguage: "es",
    texts: { es: doc(text, fieldId) },
  });
  const snapshot = {
    schema: 1,
    languages: ["es", "en"],
    sections: [
      {
        id: sections.arrival,
        kind: "arrival",
        items: [item("Abre la caja de llaves con ", lockbox!.id)],
      },
      { id: sections.wifi, kind: "wifi", items: [item("Red CasaColibri, clave ", wifi!.id)] },
      {
        id: sections.checkout,
        kind: "checkout",
        items: [item("La salida es a las 11:00. Deja las llaves en la caja.")],
      },
      {
        id: sections.house_rules,
        kind: "house_rules",
        items: [item("No se permiten fiestas. Silencio después de las 22:00.")],
      },
      {
        id: sections.emergency,
        kind: "emergency",
        items: [item("Clínica de Sámara: 200 metros al norte de la iglesia.")],
      },
    ],
  };
  const [version] = await db
    .insert(guideVersion)
    .values({
      workspaceId,
      guideId,
      number: 1,
      cause: "publish",
      snapshot,
      snapshotSchema: 1,
      languages: ["es", "en"],
      publishedBy: ownerId,
    })
    .returning({ id: guideVersion.id });
  await db
    .update(guide)
    .set({ status: "published", publishedVersionId: version!.id, publishedAt: new Date() })
    .where(eq(guide.id, guideId));
  const [conv] = await db
    .insert(conversation)
    .values({
      workspaceId,
      propertyId,
      cookieHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      language: "es",
    })
    .returning({ id: conversation.id });
  return {
    workspaceId,
    propertyId,
    conversationId: conv!.id,
    versionId: version!.id,
    sections,
    ownerEmail: `${ownerId}@example.com`,
    agentEmail: `${agentId}@example.com`,
  };
}

export async function guestSays(s: Seeded, text: string): Promise<string> {
  const [next] = await handle.db
    .select({ seq: sql<number>`coalesce(max(${chatMessage.seq}), 0)::int + 1` })
    .from(chatMessage)
    .where(eq(chatMessage.conversationId, s.conversationId));
  const [row] = await handle.db
    .insert(chatMessage)
    .values({
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      seq: next!.seq,
      author: "guest",
      body: text,
      clientId: randomUUID(),
    })
    .returning({ id: chatMessage.id });
  return row!.id;
}

export function deps(options: FakeLlmOptions = {}) {
  const llm = new FakeLlmAdapter(options);
  const emails: EmailMessage[] = [];
  const value: ChatReplyDeps = {
    db: handle.db,
    llm,
    queueEmail: async (message) => {
      emails.push(message);
    },
    portalUrl: "http://localhost:3000",
    guideUrl: "http://127.0.0.1:3001",
  };
  return { deps: value, llm, emails };
}

export async function run(s: Seeded, d: ChatReplyDeps, messageId: string) {
  return runChatReply(d, {
    workspaceId: s.workspaceId,
    conversationId: s.conversationId,
    messageId,
  });
}

export async function assistantMessages(s: Seeded) {
  return handle.db
    .select({
      kind: chatMessage.kind,
      body: chatMessage.body,
      payload: chatMessage.payload,
      seq: chatMessage.seq,
    })
    .from(chatMessage)
    .where(
      and(eq(chatMessage.conversationId, s.conversationId), eq(chatMessage.author, "assistant")),
    )
    .orderBy(asc(chatMessage.seq));
}

export async function stateOf(s: Seeded) {
  const [conv] = await handle.db
    .select({ status: conversation.status, reason: conversation.needsHostReason })
    .from(conversation)
    .where(eq(conversation.id, s.conversationId));
  const traces = await handle.db
    .select()
    .from(agentTrace)
    .where(eq(agentTrace.conversationId, s.conversationId))
    .orderBy(asc(agentTrace.createdAt));
  const drafts = await handle.db
    .select()
    .from(agentDraft)
    .where(eq(agentDraft.conversationId, s.conversationId))
    .orderBy(asc(agentDraft.createdAt));
  return { conv: conv!, traces, drafts };
}

export const methods = (llm: FakeLlmAdapter) => llm.guideCalls.map((call) => call.method);
