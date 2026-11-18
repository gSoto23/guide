import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  copilotRun,
  createDb,
  experience,
  experienceDestination,
  exploreSettings,
  guideLink,
  property,
  type DbHandle,
} from "@guidesk/db";
import type { AnswerGuestInput } from "@guidesk/integrations";
import { runCopilotDraft } from "../../src/jobs/copilot-draft.js";
import { deps, guestSays, run, seed, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * The guide chat's Explore pointer (feature 009 T024, research R11, FR-026, FR-027): the knowledge
 * has the Explore line only when Explore shows for the property; copilot drafts never do; no partner
 * content ever reaches a model. Synthetic data.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const publicId = () => Array.from({ length: 26 }, () => ALPHABET[randomInt(32)]).join("");

async function withExperiences(city: string): Promise<{ s: Seeded; link: string }> {
  const s = await seed();
  const key = `cr:${city.toLowerCase()}`;
  await handle.db.update(property).set({ city }).where(eq(property.id, s.propertyId));
  const link = publicId();
  await handle.db
    .insert(guideLink)
    .values({ workspaceId: s.workspaceId, propertyId: s.propertyId, publicId: link });
  await handle.db
    .insert(experienceDestination)
    .values({ key, country: "CR", city })
    .onConflictDoNothing();
  const now = new Date();
  await handle.db.insert(experience).values({
    partner: "viator",
    productId: `PTR${randomInt(1_000_000)}`,
    destinationKey: key,
    language: "es",
    category: "outdoor",
    title: "Canopy de PruebaSecreta",
    partnerUrl: "https://www.viator.com/tours/Test/d1-PTR",
    rating: 4.8,
    reviewCount: 200,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  return { s, link };
}

const answerInput = (llm: { guideCalls: { method: string; input: unknown }[] }) =>
  llm.guideCalls.find((call) => call.method === "answerGuest")?.input as
    AnswerGuestInput | undefined;

describe("Explore pointer (feature 009 US5)", () => {
  it("adds the Explore line with the guide link when experiences show, never partner content", async () => {
    const { s, link } = await withExperiences("Ostional");
    const { deps: d, llm } = deps();
    await run(s, d, await guestSays(s, "¿Qué tours hay por aquí?"));
    const input = answerInput(llm)!;
    expect(input.knowledge).toContain("## Explore");
    expect(input.knowledge).toContain(`http://127.0.0.1:3001/g/${link}/es/explore`);
    for (const call of llm.guideCalls) {
      expect(JSON.stringify(call.input)).not.toContain("PruebaSecreta");
      expect(JSON.stringify(call.input)).not.toContain("viator.com");
    }
  });

  it("leaves it out when Explore doesn't show, and never gives it to the copilot", async () => {
    const plain = await seed();
    const first = deps();
    await run(plain, first.deps, await guestSays(plain, "¿Qué tours hay por aquí?"));
    expect(answerInput(first.llm)!.knowledge).not.toContain("## Explore");

    const { s } = await withExperiences("Cabuya");
    await handle.db
      .insert(exploreSettings)
      .values({ workspaceId: s.workspaceId, experiencesEnabled: false });
    const off = deps();
    await run(s, off.deps, await guestSays(s, "¿Qué tours hay por aquí?"));
    expect(answerInput(off.llm)!.knowledge).not.toContain("## Explore");

    const { s: other } = await withExperiences("Montezuma");
    const [row] = await handle.db
      .insert(copilotRun)
      .values({
        workspaceId: other.workspaceId,
        propertyId: other.propertyId,
        createdBy: other.ownerId,
        message: "¿Qué tours hay por aquí?",
        bookingStatus: "confirmed",
      })
      .returning({ id: copilotRun.id });
    const copilot = deps();
    await runCopilotDraft(copilot.deps, { runId: row!.id, workspaceId: other.workspaceId });
    const input = answerInput(copilot.llm)!;
    expect(input.channel).toBe("platform");
    expect(input.knowledge).not.toContain("## Explore");
    expect(input.knowledge).not.toContain("/explore");
  });
});
