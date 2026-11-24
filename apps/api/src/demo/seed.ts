import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  agentDraft,
  agentTrace,
  assistantSettings,
  chatMessage,
  chatUsageDaily,
  conversation,
  createGuideForProperty,
  experienceClickDaily,
  exploreOpenDaily,
  exploreSettings,
  extra,
  guide,
  guideItem,
  guideItemText,
  guideLink,
  guideOpenDaily,
  guideSection,
  guideVersion,
  membership,
  property,
  restrictedValue,
  securityEvent,
  serviceRequest,
  serviceRequestDaily,
  stay,
  stayLink,
  user,
  workspace,
  type Database,
} from "@guidesk/db";
import {
  buildSnapshot,
  encodePropertyLinkId,
  encodeStayToken,
  SNAPSHOT_SCHEMA,
  STAY_TOKEN_BYTES,
  textHash,
  type DraftSection,
  type SegDocument,
} from "@guidesk/domain";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import {
  DEMO_GUEST_NAMES,
  DEMO_OPEN_ESCALATION,
  DEMO_PROPERTIES,
  DEMO_QUESTIONS,
  type DemoBlock,
  type DemoLanguage,
  type DemoProperty,
} from "./content.js";
import { aiReplies, planHistory, type PlannedQuestion } from "./history.js";

/**
 * The demo workspace (feature 014 US3, research R9 to R17): one transaction that builds a lived-in
 * workspace from synthetic content, encrypting the door codes and stay links with the vault like the
 * product does. It never calls the AI model, a partner, or a notification channel, and it never
 * returns or logs a code or a stay link.
 */
export type DemoSeedErrorCode =
  "usage" | "production_refused" | "unknown_account" | "unverified_account";

export class DemoSeedError extends Error {
  constructor(
    readonly code: DemoSeedErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** AC-SEC-001: never on the production stage, or on a deployed stage that doesn't say which. */
export function assertDemoAllowed(env: { NODE_ENV?: string; STAGE?: string }): void {
  if (env.STAGE === "production") {
    throw new DemoSeedError("production_refused", "The demo command never runs on production.");
  }
  if (env.NODE_ENV === "production" && !env.STAGE) {
    throw new DemoSeedError(
      "production_refused",
      "STAGE is not set on a deployed stage, so the demo command can't tell it isn't production.",
    );
  }
}

export interface DemoSeedResult {
  workspaceId: string;
  workspaceName: string;
  properties: { name: string; guideUrl: string }[];
  stays: number;
}

export interface DemoSeedDeps {
  db: Database;
  vault: Vault;
}

export interface DemoSeedInput {
  email: string;
  guideUrl: string;
  now?: Date;
  /** Tests only: fails after the first inserts, to prove the run is all or nothing. */
  failAfterWorkspace?: boolean;
}

const DAY_MS = 86_400_000;
const CHANNELS = ["Airbnb", "Booking.com", "Vrbo", "Directo"] as const;
const LANGUAGES: readonly DemoLanguage[] = ["es", "en"];
const DEMO_NAME = "Demo · Guidesk";

/** A day in the property's time zone, as YYYY-MM-DD, `offset` days from `now`. */
function localDate(now: Date, timeZone: string, offset: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + offset * DAY_MS));
}

/** The zone's UTC offset, for example "-06:00". */
function zoneOffset(now: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((entry) => entry.type === "timeZoneName")?.value;
  const offset = part?.replace("GMT", "") ?? "";
  return offset === "" ? "+00:00" : offset;
}

/** A local date and time in the property's zone, as an instant. */
function localInstant(date: string, hour: number, minute: number, offset: string): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00${offset}`);
}

function cookieHash(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A block of content as a segment document; `{door}` and `{wifi}` become locked fields. */
function toDocument(blocks: readonly DemoBlock[], fields: Record<string, string>): SegDocument {
  const inline = (text: string) =>
    text
      .split(/(\{door\}|\{wifi\})/)
      .filter((part) => part !== "")
      .map((part) => {
        const field = part === "{door}" ? fields.door : part === "{wifi}" ? fields.wifi : null;
        return field
          ? { type: "lockedField" as const, attrs: { fieldId: field } }
          : { type: "text" as const, text: part };
      });
  return {
    type: "doc",
    content: blocks.map((block) =>
      typeof block === "string"
        ? { type: "paragraph" as const, content: inline(block) }
        : {
            type: "bulletList" as const,
            content: block.list.map((entry) => ({
              type: "listItem" as const,
              content: [{ type: "paragraph" as const, content: inline(entry) }],
            })),
          },
    ),
  };
}

function plainLength(blocks: readonly DemoBlock[]): number {
  return blocks
    .flatMap((block) => (typeof block === "string" ? [block] : block.list))
    .reduce((sum, text) => sum + text.length, 0);
}

export async function seedDemo(deps: DemoSeedDeps, input: DemoSeedInput): Promise<DemoSeedResult> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new DemoSeedError("usage", "Pass the account's email.");
  const [owner] = await deps.db
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`);
  if (!owner) throw new DemoSeedError("unknown_account", "No account uses that email.");
  if (!owner.emailVerified) {
    throw new DemoSeedError("unverified_account", "That account's email is not verified.");
  }

  const now = input.now ?? new Date();
  const createdAt = new Date(now.getTime() - 75 * DAY_MS);
  const guideUrl = input.guideUrl.replace(/\/$/, "");

  return deps.db.transaction(async (tx) => {
    const store = createDataKeyStore(tx);
    const workspaceId = randomUUID();

    const [{ count: existing } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(workspace)
      .innerJoin(membership, eq(membership.workspaceId, workspace.id))
      .where(and(eq(workspace.demo, true), eq(membership.userId, owner.id)));
    const workspaceName = existing === 0 ? DEMO_NAME : `${DEMO_NAME} ${existing + 1}`;

    await tx.insert(workspace).values({
      id: workspaceId,
      name: workspaceName,
      createdBy: owner.id,
      plan: "pro",
      planChangedAt: createdAt,
      planNote: "demo",
      demo: true,
      createdAt,
    });
    await tx.insert(membership).values({ workspaceId, userId: owner.id, role: "owner" });
    if (input.failAfterWorkspace) throw new Error("forced failure (test)");

    // The assistant answers Wi-Fi and arrival questions by itself; everything else waits for the
    // host (the `draft` default), and sensitive topics always go to the host (spec 007).
    await tx.insert(assistantSettings).values({
      workspaceId,
      autonomy: { arrival: "auto", wifi: "auto" },
      updatedBy: owner.id,
    });
    await tx.insert(exploreSettings).values({ workspaceId, updatedBy: owner.id });

    const results: DemoSeedResult["properties"] = [];
    let stayCount = 0;
    let openEscalationDone = false;

    for (const content of DEMO_PROPERTIES) {
      const built = await buildProperty(tx, store, deps.vault, {
        content,
        workspaceId,
        ownerId: owner.id,
        now,
        createdAt,
        withOpenEscalation: !openEscalationDone,
      });
      openEscalationDone = true;
      stayCount += built.stays;
      results.push({ name: content.name, guideUrl: `${guideUrl}/g/${built.publicId}` });
    }

    await tx.insert(securityEvent).values({
      type: "workspace.demo_seeded",
      outcome: "success",
      actorUserId: owner.id,
      workspaceId,
      targetType: "workspace",
      targetId: workspaceId,
      metadata: { properties: results.length, stays: stayCount },
    });

    return { workspaceId, workspaceName, properties: results, stays: stayCount };
  });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Store = ReturnType<typeof createDataKeyStore>;

async function buildProperty(
  tx: Tx,
  store: Store,
  vault: Vault,
  input: {
    content: DemoProperty;
    workspaceId: string;
    ownerId: string;
    now: Date;
    createdAt: Date;
    withOpenEscalation: boolean;
  },
): Promise<{ publicId: string; stays: number }> {
  const { content, workspaceId, ownerId, now, createdAt } = input;
  const offset = zoneOffset(now, content.timeZone);
  const day = (offsetDays: number) => localDate(now, content.timeZone, offsetDays);

  const [created] = await tx
    .insert(property)
    .values({
      workspaceId,
      name: content.name,
      addressLine1: content.addressLine1,
      city: content.city,
      region: content.region,
      postalCode: content.postalCode,
      country: "CR",
      timeZone: content.timeZone,
      checkInTime: content.checkInTime,
      checkoutTime: content.checkoutTime,
      maxGuests: content.maxGuests,
      guideLanguages: ["es", "en"],
      setupStatus: "ready",
      source: "manual",
      createdBy: ownerId,
      createdAt,
    })
    .returning({ id: property.id });
  const propertyId = created!.id;

  // The guide, its nine sections, and the fact items, exactly as property creation makes them.
  const { guideId } = await createGuideForProperty(tx, {
    workspaceId,
    propertyId,
    guideLanguages: ["es", "en"],
  });

  // Locked fields: the door code is vault ciphertext bound to its row (SEC-06); the Wi-Fi password
  // is public by design.
  const doorId = randomUUID();
  const door = await vault.encrypt(
    store,
    { workspaceId, table: "restricted_value", column: "value_ciphertext", rowId: doorId },
    content.doorCode,
  );
  const wifiId = randomUUID();
  await tx.insert(restrictedValue).values([
    {
      id: doorId,
      workspaceId,
      propertyId,
      kind: "door_code",
      label: "Código de la puerta",
      valueCiphertext: door.ciphertext,
      dataKeyId: door.dataKeyId,
      source: "host",
      sectionKind: "arrival",
      valueSetAt: createdAt,
      updatedBy: ownerId,
    },
    {
      id: wifiId,
      workspaceId,
      propertyId,
      kind: "wifi_password",
      label: "Contraseña del Wi-Fi",
      publicValue: content.wifiShown,
      source: "host",
      sectionKind: "wifi",
      valueSetAt: createdAt,
      updatedBy: ownerId,
    },
  ]);

  // Section items in Spanish (the source) and English (reviewed).
  const sections = await tx
    .select({ id: guideSection.id, kind: guideSection.kind, position: guideSection.position })
    .from(guideSection)
    .where(eq(guideSection.guideId, guideId));
  const facts = await tx
    .select({
      id: guideItem.id,
      sectionId: guideItem.sectionId,
      position: guideItem.position,
      factKey: guideItem.factKey,
    })
    .from(guideItem)
    .where(
      and(
        eq(guideItem.workspaceId, workspaceId),
        sql`${guideItem.sectionId} IN (SELECT id FROM guide_section WHERE guide_id = ${guideId})`,
      ),
    );
  const reviewedAt = new Date(createdAt.getTime() + DAY_MS);
  const draft: DraftSection[] = [];
  for (const section of sections) {
    const items: DraftSection["items"][number][] = facts
      .filter((fact) => fact.sectionId === section.id)
      .map((fact) => ({
        id: fact.id,
        kind: "fact",
        position: fact.position,
        source: "host",
        reviewed: true,
        sourceLanguage: "es",
        topics: [],
        factKey: fact.factKey as never,
        texts: {},
      }));
    const entries = content.sections[section.kind as keyof DemoProperty["sections"]] ?? [];
    for (const [index, entry] of entries.entries()) {
      const itemId = randomUUID();
      const position = 10 + index;
      await tx.insert(guideItem).values({
        id: itemId,
        workspaceId,
        sectionId: section.id,
        kind: "text",
        position,
        source: "host",
        reviewedAt,
        reviewedBy: ownerId,
        sourceLanguage: "es",
        topics: entry.topics ?? [],
      });
      const docs = Object.fromEntries(
        LANGUAGES.map((language) => [
          language,
          toDocument(entry.texts[language], { door: doorId, wifi: wifiId }),
        ]),
      ) as Record<DemoLanguage, SegDocument>;
      await tx.insert(guideItemText).values(
        LANGUAGES.map((language) => ({
          itemId,
          language,
          workspaceId,
          doc: docs[language],
          textLength: plainLength(entry.texts[language]),
          origin: language === "es" ? ("source" as const) : ("reviewed" as const),
          state: "current" as const,
          sourceHash: language === "es" ? null : textHash(JSON.stringify(docs.es)),
        })),
      );
      items.push({
        id: itemId,
        kind: "text",
        position,
        source: "host",
        reviewed: true,
        sourceLanguage: "es",
        topics: entry.topics ?? [],
        texts: {
          es: { doc: docs.es, origin: "source", state: "current" },
          en: { doc: docs.en, origin: "reviewed", state: "current" },
        },
      });
    }
    draft.push({
      id: section.id,
      kind: section.kind as DraftSection["kind"],
      position: section.position,
      hidden: false,
      items,
    });
  }

  const snapshot = buildSnapshot({
    languages: ["es", "en"],
    sections: draft,
    sharedBlocks: [],
    links: {},
  });
  const [version] = await tx
    .insert(guideVersion)
    .values({
      workspaceId,
      guideId,
      number: 1,
      cause: "publish",
      snapshot,
      snapshotSchema: SNAPSHOT_SCHEMA,
      languages: ["es", "en"],
      publishedBy: ownerId,
      publishedAt: reviewedAt,
    })
    .returning({ id: guideVersion.id });
  await tx
    .update(guide)
    .set({
      status: "published",
      publishedVersionId: version!.id,
      publishedAt: reviewedAt,
      publishedBy: ownerId,
      hasUnpublishedChanges: false,
      draftState: "ready",
      completeness: 100,
    })
    .where(eq(guide.id, guideId));

  const publicId = encodePropertyLinkId(randomBytes(17));
  await tx.insert(guideLink).values({ workspaceId, propertyId, publicId, createdBy: ownerId });

  const extras = await tx
    .insert(extra)
    .values(
      content.extras.map((entry, position) => ({
        workspaceId,
        propertyId,
        sourceLanguage: "es" as const,
        name: entry.name,
        description: entry.description,
        price: entry.price,
        currency: "USD" as const,
        needsDate: entry.needsDate,
        maxPerStay: entry.maxPerStay,
        position,
        updatedBy: ownerId,
      })),
    )
    .returning({ id: extra.id });

  const plan = planHistory({
    seed: `${workspaceId}:${content.key}`,
    today: now,
    questionsPerDay: content.questionsPerDay,
    guestNames: DEMO_GUEST_NAMES,
    extras: content.extras.length,
    maxGuests: content.maxGuests,
  });

  // Stays: the history's past stays, then the current one (yesterday to three days from now, in the
  // property's time zone, so its link works now) and an upcoming one.
  const stays = [
    ...plan.pastStays.map((entry, index) => ({
      checkIn: day(-entry.checkInDaysAgo),
      checkout: day(-entry.checkInDaysAgo + entry.nights),
      guestName: entry.guestName,
      guestCount: entry.guestCount,
      openedAt: entry.openedGuide
        ? localInstant(day(-entry.checkInDaysAgo), 16, 10 + (index % 40), offset)
        : null,
      requests: entry.requests,
      role: "past" as const,
    })),
    {
      checkIn: day(-1),
      checkout: day(3),
      guestName: content.key === "brisa" ? "Emily" : "Lucas",
      guestCount: Math.min(2, content.maxGuests),
      openedAt: new Date(now.getTime() - 20 * 3_600_000),
      requests: [] as { extra: number; status: "confirmed" | "declined" }[],
      role: "current" as const,
    },
    {
      checkIn: day(10),
      checkout: day(14),
      guestName: content.key === "brisa" ? "Sofía" : "Daniel",
      guestCount: Math.min(4, content.maxGuests),
      openedAt: null,
      requests: [] as { extra: number; status: "confirmed" | "declined" }[],
      role: "upcoming" as const,
    },
  ];
  const stayRows = await tx
    .insert(stay)
    .values(
      stays.map((entry, index) => ({
        workspaceId,
        propertyId,
        source: "manual" as const,
        checkInDate: entry.checkIn,
        checkoutDate: entry.checkout,
        channel: CHANNELS[index % CHANNELS.length]!,
        guestCount: entry.guestCount,
        guestName: entry.guestName,
        // Feature 018: typed by the host, and a fictional Airbnb code on Airbnb stays.
        guestDetailsSource: "host" as const,
        bookingReference:
          CHANNELS[index % CHANNELS.length] === "Airbnb"
            ? `HMDEMO${String(index + 1).padStart(4, "0")}`
            : null,
        createdBy: ownerId,
        guideOpenedAt: entry.openedAt,
      })),
    )
    .returning({ id: stay.id });
  const currentStayId = stayRows[stays.length - 2]!.id;

  // Stay links for the current and upcoming stays: the token is generated, hashed, and encrypted
  // here, then dropped; the founder copies the link from the portal (FR-028, AC-SEC-003).
  for (const stayId of [currentStayId, stayRows[stays.length - 1]!.id]) {
    const id = randomUUID();
    const token = encodeStayToken(randomBytes(STAY_TOKEN_BYTES));
    const sealed = await vault.encrypt(
      store,
      { workspaceId, table: "stay_link", column: "token_ciphertext", rowId: id },
      token,
    );
    await tx.insert(stayLink).values({
      id,
      workspaceId,
      propertyId,
      stayId,
      tokenHash: sha256(token),
      tokenCiphertext: sealed.ciphertext,
      dataKeyId: sealed.dataKeyId,
      createdBy: ownerId,
    });
  }

  // Requests: the past stays' answered ones, and one waiting on the current stay.
  const requestCounts = new Map<string, number>();
  const count = (date: string, status: string) =>
    requestCounts.set(`${date}|${status}`, (requestCounts.get(`${date}|${status}`) ?? 0) + 1);
  const requestRows: (typeof serviceRequest.$inferInsert)[] = [];
  stays.forEach((entry, index) => {
    for (const request of entry.requests) {
      const chosen = content.extras[request.extra]!;
      const madeAt = localInstant(entry.checkIn, 18, 5, offset);
      requestRows.push({
        workspaceId,
        propertyId,
        stayId: stayRows[index]!.id,
        extraId: extras[request.extra]!.id,
        extraName: chosen.name,
        sourceLanguage: "es",
        price: chosen.price,
        currency: "USD",
        requestedDate: entry.checkIn,
        status: request.status,
        reasonCode: request.status === "declined" ? "fully_booked" : null,
        answeredBy: ownerId,
        answeredAt: new Date(madeAt.getTime() + 2 * 3_600_000),
        expiresAt: new Date(madeAt.getTime() + DAY_MS),
        createdAt: madeAt,
      });
      count(entry.checkIn, "waiting");
      count(entry.checkIn, request.status);
    }
  });
  const cleaning = content.extras.findIndex((entry) => entry.name.en === "Extra cleaning");
  requestRows.push({
    workspaceId,
    propertyId,
    stayId: currentStayId,
    extraId: extras[cleaning]!.id,
    extraName: content.extras[cleaning]!.name,
    sourceLanguage: "es",
    price: content.extras[cleaning]!.price,
    currency: "USD",
    requestedDate: day(1),
    status: "waiting",
    note: "Por la mañana, si es posible.",
    expiresAt: new Date(now.getTime() + 2 * DAY_MS),
    createdAt: new Date(now.getTime() - 2 * 3_600_000),
  });
  count(day(0), "waiting");
  if (requestRows.length > 0) await tx.insert(serviceRequest).values(requestRows);
  if (requestCounts.size > 0) {
    await tx.insert(serviceRequestDaily).values(
      [...requestCounts].map(([key, value]) => {
        const [date, status] = key.split("|") as [
          string,
          (typeof serviceRequestDaily.$inferInsert)["status"],
        ];
        return { workspaceId, propertyId, day: date, status, count: value };
      }),
    );
  }

  // Daily counters: guide opens, Explore opens, and partner clicks.
  await tx.insert(guideOpenDaily).values(
    plan.days.flatMap((entry) => [
      {
        workspaceId,
        propertyId,
        day: day(-entry.daysAgo),
        linkKind: "property" as const,
        opens: entry.propertyOpens,
      },
      {
        workspaceId,
        propertyId,
        day: day(-entry.daysAgo),
        linkKind: "stay" as const,
        opens: entry.stayOpens,
      },
    ]),
  );
  await tx.insert(exploreOpenDaily).values(
    plan.days.map((entry) => ({
      workspaceId,
      propertyId,
      day: day(-entry.daysAgo),
      opens: entry.exploreOpens,
    })),
  );
  const clicks = plan.days.flatMap((entry) =>
    entry.clicks.map((click) => ({
      workspaceId,
      propertyId,
      day: day(-entry.daysAgo),
      partner: click.partner,
      ref: click.ref,
      clicks: click.clicks,
    })),
  );
  if (clicks.length > 0) await tx.insert(experienceClickDaily).values(clicks);

  // Guest questions: one conversation each, with the question, the assistant's reply or holding
  // message, and the trace (topic, decision, reason). Past conversations are done.
  const usage = new Map<string, { replies: number; cost: number }>();
  for (const entry of plan.days) {
    const date = day(-entry.daysAgo);
    await addQuestions(tx, {
      workspaceId,
      propertyId,
      ownerId,
      date,
      offset,
      now,
      questions: entry.questions,
    });
    const replies = aiReplies(entry.questions);
    if (replies > 0) usage.set(date, { replies, cost: replies * 41_000 });
  }

  if (input.withOpenEscalation) {
    await addOpenEscalation(tx, { workspaceId, propertyId, stayId: currentStayId, now });
  }
  if (usage.size > 0) {
    await tx.insert(chatUsageDaily).values(
      [...usage].map(([date, value]) => ({
        workspaceId,
        propertyId,
        day: date,
        replies: value.replies,
        costUsdMicros: value.cost,
      })),
    );
  }

  return { publicId, stays: stays.length };
}

async function addQuestions(
  tx: Tx,
  input: {
    workspaceId: string;
    propertyId: string;
    ownerId: string;
    date: string;
    offset: string;
    now: Date;
    questions: readonly PlannedQuestion[];
  },
): Promise<void> {
  const { workspaceId, propertyId, ownerId } = input;
  for (const [index, planned] of input.questions.entries()) {
    const scenario = DEMO_QUESTIONS[planned.scenario]!;
    let askedAt = localInstant(input.date, planned.hour, (index * 13) % 60, input.offset);
    if (askedAt.getTime() > input.now.getTime() - 60_000) {
      askedAt = new Date(input.now.getTime() - (index + 2) * 9 * 60_000);
    }
    const repliedAt = new Date(askedAt.getTime() + 40_000);
    const old = input.now.getTime() - askedAt.getTime() > 6 * 3_600_000;
    const [row] = await tx
      .insert(conversation)
      .values({
        workspaceId,
        propertyId,
        cookieHash: cookieHash(),
        language: planned.language,
        status: old ? "done" : "open",
        lastMessageAt: repliedAt,
        doneAt: old ? new Date(repliedAt.getTime() + 3_600_000) : null,
        doneBy: old ? ownerId : null,
      })
      .returning({ id: conversation.id });
    const conversationId = row!.id;
    const [guestMessage, reply] = await tx
      .insert(chatMessage)
      .values([
        {
          workspaceId,
          conversationId,
          seq: 1,
          author: "guest" as const,
          body: scenario.question[planned.language],
          createdAt: askedAt,
        },
        {
          workspaceId,
          conversationId,
          seq: 2,
          author: "assistant" as const,
          kind:
            scenario.decision === "pointer"
              ? ("pointer" as const)
              : scenario.reason === "emergency"
                ? ("emergency" as const)
                : scenario.decision === "answered"
                  ? ("text" as const)
                  : ("holding" as const),
          body: scenario.reply[planned.language],
          createdAt: repliedAt,
        },
      ])
      .returning({ id: chatMessage.id });
    const answered = scenario.decision === "answered" || scenario.decision === "pointer";
    await tx.insert(agentTrace).values({
      workspaceId,
      conversationId,
      guestMessageId: guestMessage!.id,
      replyMessageId: answered ? reply!.id : null,
      classification: { topic: scenario.topic },
      decision: scenario.decision,
      reason: scenario.reason as (typeof agentTrace.$inferInsert)["reason"],
      autonomy: scenario.topic === "wifi" || scenario.topic === "arrival" ? "auto" : "draft",
      autonomySource: "workspace",
      answerKind: answered ? "grounded" : null,
      model: "demo",
      costUsdMicros: scenario.decision === "held" ? 0 : 41_000,
      createdAt: repliedAt,
    });
  }
}

/** The malfunction waiting for the host, with an open draft (FR-024). No alert is sent. */
async function addOpenEscalation(
  tx: Tx,
  input: { workspaceId: string; propertyId: string; stayId: string; now: Date },
): Promise<void> {
  const { workspaceId, propertyId, stayId, now } = input;
  const askedAt = new Date(now.getTime() - 25 * 60_000);
  const repliedAt = new Date(askedAt.getTime() + 30_000);
  const [row] = await tx
    .insert(conversation)
    .values({
      workspaceId,
      propertyId,
      stayId,
      cookieHash: cookieHash(),
      language: "en",
      status: "needs_host",
      needsHostReason: "malfunction",
      lastMessageAt: repliedAt,
    })
    .returning({ id: conversation.id });
  const conversationId = row!.id;
  const [guestMessage] = await tx
    .insert(chatMessage)
    .values([
      {
        workspaceId,
        conversationId,
        seq: 1,
        author: "guest" as const,
        body: DEMO_OPEN_ESCALATION.question.en,
        createdAt: askedAt,
      },
      {
        workspaceId,
        conversationId,
        seq: 2,
        author: "assistant" as const,
        kind: "holding" as const,
        body: DEMO_OPEN_ESCALATION.reply.en,
        createdAt: repliedAt,
      },
    ])
    .returning({ id: chatMessage.id });
  const [trace] = await tx
    .insert(agentTrace)
    .values({
      workspaceId,
      conversationId,
      guestMessageId: guestMessage!.id,
      classification: { topic: DEMO_OPEN_ESCALATION.topic },
      decision: "held",
      reason: "malfunction",
      autonomy: "draft",
      autonomySource: "workspace",
      model: "demo",
      createdAt: repliedAt,
    })
    .returning({ id: agentTrace.id });
  await tx.insert(agentDraft).values({
    workspaceId,
    conversationId,
    traceId: trace!.id,
    body: DEMO_OPEN_ESCALATION.draft.en,
  });
}
