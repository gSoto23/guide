import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  createDb,
  createGuideForProperty,
  guideItem,
  guideItemText,
  guideSection,
  membership,
  property,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { FakeLlmAdapter } from "@guidesk/integrations";
import {
  findTranslationWork,
  runGuideTranslate,
  sourceHashOf,
} from "../../src/jobs/guide-translate.js";

/**
 * The translation job (feature 003 T094, research R7, FR-044 to FR-047, FR-025): one call per
 * section and language, tags kept, a mismatch retried once and then failed, masked codes restored
 * and never sent, the daily limit, reviewed texts left alone, single-language guides, the sweep
 * for unscheduled work, and timing with model latency (SC-005). Fictional text only.
 */
let handle: DbHandle;
let workspaceId: string;
let guideId: string;
let sectionId: string;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
});

afterAll(async () => {
  await handle.pool.end();
});

async function seed(languages: ("es" | "en")[] = ["es", "en"]) {
  const ownerId = `owner-${randomUUID()}`;
  workspaceId = randomUUID();
  await handle.db
    .insert(user)
    .values({ id: ownerId, name: "Dueña", email: `${ownerId}@example.com` });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  const [row] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa Traducida",
      guideLanguages: languages,
      setupStatus: "ready",
      source: "manual",
    })
    .returning({ id: property.id });
  guideId = (
    await createGuideForProperty(handle.db, {
      workspaceId,
      propertyId: row!.id,
      guideLanguages: languages,
    })
  ).guideId;
  const [section] = await handle.db
    .select({ id: guideSection.id })
    .from(guideSection)
    .where(and(eq(guideSection.guideId, guideId), eq(guideSection.kind, "appliances")));
  sectionId = section!.id;
}

beforeEach(async () => {
  await seed();
});

const paragraph = (...content: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (value: string, marks?: object[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

async function addItem(
  doc: object,
  options: { translation?: { state: string; origin: string; doc?: object | null } } = {},
): Promise<string> {
  const [item] = await handle.db
    .insert(guideItem)
    .values({
      workspaceId,
      sectionId,
      kind: "text",
      position: Math.floor(Math.random() * 1000),
      source: "host",
      reviewedAt: new Date(),
      sourceLanguage: "es",
    })
    .returning({ id: guideItem.id });
  await handle.db.insert(guideItemText).values({
    itemId: item!.id,
    language: "es",
    workspaceId,
    doc,
    textLength: 10,
    origin: "source",
    state: "current",
  });
  if (options.translation) {
    await handle.db.insert(guideItemText).values({
      itemId: item!.id,
      language: "en",
      workspaceId,
      doc: options.translation.doc ?? null,
      textLength: 0,
      origin: options.translation.origin as "machine" | "reviewed",
      state: options.translation.state as "stale" | "current" | "out_of_date",
    });
  }
  return item!.id;
}

async function textOf(itemId: string, language = "en") {
  const [row] = await handle.db
    .select()
    .from(guideItemText)
    .where(and(eq(guideItemText.itemId, itemId), eq(guideItemText.language, language as "en")));
  return row;
}

const job = () => ({ workspaceId, sectionId, language: "en" as const });

describe("the translation job (T094)", () => {
  it("translates every waiting item of the section in one call, keeping tags", async () => {
    const llm = new FakeLlmAdapter();
    const bold = await addItem(
      paragraph(text("Presione "), text("el botón azul", [{ type: "bold" }]), text(" dos veces.")),
    );
    const stale = await addItem(paragraph(text("La cafetera está arriba.")), {
      translation: { state: "stale", origin: "machine", doc: paragraph(text("old")) },
    });
    expect(await runGuideTranslate({ db: handle.db, llm }, job())).toBe("translated");
    expect(llm.guideCalls.filter((call) => call.method === "translateBlocks")).toHaveLength(1);
    const first = await textOf(bold);
    expect(first).toMatchObject({ origin: "machine", state: "current", pendingReason: null });
    expect(JSON.stringify(first?.doc)).toContain('"type":"bold"');
    expect(JSON.stringify(first?.doc)).toContain("[en]");
    const source = (await textOf(bold, "es"))!;
    expect(first?.sourceHash).toBe(sourceHashOf(source.doc));
    expect((await textOf(stale))?.state).toBe("current");
  });

  it("restores masked codes unchanged and never sends them (FR-025)", async () => {
    const llm = new FakeLlmAdapter();
    const itemId = await addItem(paragraph(text("El código de la puerta es 4821.")));
    await runGuideTranslate({ db: handle.db, llm }, job());
    expect(JSON.stringify(llm.guideCalls)).not.toContain("4821");
    expect(JSON.stringify(llm.guideCalls)).toContain("{{R1}}");
    expect(JSON.stringify((await textOf(itemId))?.doc)).toContain("4821");
  });

  it("retries a tag mismatch once, then fails with tokens_mismatch (FR-047)", async () => {
    let calls = 0;
    const llm = new FakeLlmAdapter({
      translate: (blocks) => {
        calls += 1;
        return blocks.map((block) => block.replace(/<\/?b>/g, ""));
      },
    });
    const itemId = await addItem(
      paragraph(text("Use "), text("el control", [{ type: "bold" }]), text(".")),
    );
    expect(await runGuideTranslate({ db: handle.db, llm }, job())).toBe("failed");
    expect(calls).toBe(2);
    expect(await textOf(itemId)).toMatchObject({
      state: "failed",
      pendingReason: "tokens_mismatch",
    });

    // A retry that comes back right is stored.
    let second = 0;
    const flaky = new FakeLlmAdapter({
      translate: (blocks) => {
        second += 1;
        return second === 1 ? blocks.map(() => "sin etiquetas") : blocks.map((b) => `[en] ${b}`);
      },
    });
    const other = await addItem(
      paragraph(text("Gire "), text("la perilla", [{ type: "italic" }]), text(".")),
    );
    await handle.db
      .update(guideItemText)
      .set({ state: "stale" })
      .where(and(eq(guideItemText.itemId, itemId), eq(guideItemText.language, "en")));
    await runGuideTranslate({ db: handle.db, llm: flaky }, job());
    expect((await textOf(other))?.state).toBe("current");
  });

  it("waits at the daily AI limit with ai_limit and makes no call", async () => {
    await handle.db.execute(
      sql`UPDATE workspace SET guide_ai_daily_limit = 1 WHERE id = ${workspaceId}`,
    );
    await handle.db.execute(sql`
      INSERT INTO rate_limit_bucket (key, window_start, count)
      VALUES (${`guide-ai:${workspaceId}:${new Date().toISOString().slice(0, 10)}`},
              date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 5)
      ON CONFLICT (key, window_start) DO UPDATE SET count = 5`);
    const llm = new FakeLlmAdapter();
    const itemId = await addItem(paragraph(text("La lavadora está en el patio.")));
    expect(await runGuideTranslate({ db: handle.db, llm }, job())).toBe("waiting_limit");
    expect(llm.guideCalls).toHaveLength(0);
    expect(await textOf(itemId)).toMatchObject({ state: "pending", pendingReason: "ai_limit" });
  });

  it("never overwrites a reviewed or out-of-date translation (FR-045, FR-046)", async () => {
    const llm = new FakeLlmAdapter();
    const reviewed = await addItem(paragraph(text("El horno tarda en calentar.")), {
      translation: { state: "current", origin: "reviewed", doc: paragraph(text("Mine")) },
    });
    const outOfDate = await addItem(paragraph(text("La tele usa el control negro.")), {
      translation: { state: "out_of_date", origin: "reviewed", doc: paragraph(text("Mine too")) },
    });
    expect(await runGuideTranslate({ db: handle.db, llm }, job())).toBe("nothing_to_do");
    expect(JSON.stringify((await textOf(reviewed))?.doc)).toContain("Mine");
    expect((await textOf(outOfDate))?.state).toBe("out_of_date");
    expect(llm.guideCalls).toHaveLength(0);
  });

  it("makes no call for a single-language guide (US5 scenario 6)", async () => {
    await seed(["es"]);
    const llm = new FakeLlmAdapter();
    await addItem(paragraph(text("Solo en español.")));
    expect(await runGuideTranslate({ db: handle.db, llm }, job())).toBe("nothing_to_do");
    expect(llm.guideCalls).toHaveLength(0);
  });

  it("finds unscheduled work for the sweep, and leaves recent saves to their own job", async () => {
    const itemId = await addItem(paragraph(text("La toalla de playa está en el armario.")));
    expect(
      (await findTranslationWork(handle.db)).some((entry) => entry.sectionId === sectionId),
    ).toBe(false);
    await handle.db.execute(
      sql`UPDATE guide_item_text SET updated_at = now() - interval '1 minute' WHERE item_id = ${itemId}`,
    );
    expect(await findTranslationWork(handle.db)).toContainEqual({
      workspaceId,
      sectionId,
      language: "en",
    });
  });

  it("translates a section within 2 minutes with model latency (SC-005)", async () => {
    const llm = new FakeLlmAdapter({ delayMs: 3_000 });
    for (let index = 0; index < 10; index += 1) {
      await addItem(paragraph(text(`Instrucción ${index}: abra la ventana del cuarto.`)));
    }
    const started = performance.now();
    expect(await runGuideTranslate({ db: handle.db, llm }, job())).toBe("translated");
    // 20 seconds of debounce plus the job stay well under 2 minutes.
    expect(20_000 + (performance.now() - started)).toBeLessThan(120_000);
  }, 30_000);
});
