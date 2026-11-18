import type { ChatSectionRef, GuestChatMessage, MemberChatMessage } from "@guidesk/contracts";

/** A stored chat message as the guest and member routes read it (data model §1). */
export interface StoredChatMessage {
  id: string;
  seq: number;
  author: "guest" | "assistant" | "host";
  kind: "text" | "holding" | "emergency" | "pointer" | "greeting" | "pause";
  body: string;
  payload: Record<string, unknown> | null;
  authorName: string | null;
  createdAt: Date;
}

export function payloadSections(payload: Record<string, unknown> | null): ChatSectionRef[] {
  const sections = payload?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.filter(
    (section): section is ChatSectionRef =>
      typeof section === "object" &&
      section !== null &&
      typeof (section as ChatSectionRef).id === "string" &&
      typeof (section as ChatSectionRef).title === "string",
  );
}

/**
 * Host messages carry the member's display name; assistant replies a member sent stay the
 * assistant's (FR-027).
 */
export function toGuestMessage(row: StoredChatMessage): GuestChatMessage {
  const message: GuestChatMessage = {
    seq: row.seq,
    author: row.author,
    kind: row.kind,
    body: row.body,
    sections: payloadSections(row.payload),
    authorName: row.author === "host" ? row.authorName : null,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.kind === "emergency") {
    const emergency = (row.payload?.emergency ?? {}) as { number?: unknown; text?: unknown };
    message.emergency = {
      number: typeof emergency.number === "string" ? emergency.number : null,
      text: typeof emergency.text === "string" ? emergency.text : null,
    };
  }
  return message;
}

export function toMemberMessage(row: StoredChatMessage): MemberChatMessage {
  return {
    id: row.id,
    seq: row.seq,
    author: row.author,
    kind: row.kind,
    body: row.body,
    sections: payloadSections(row.payload),
    authorName: row.author === "guest" ? null : row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}
