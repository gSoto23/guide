import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { copilotRun, createDb, extra, guideLink, type DbHandle } from "@guidesk/db";
import type { AnswerGuestInput } from "@guidesk/integrations";
import { runCopilotDraft } from "../../src/jobs/copilot-draft.js";
import { deps, guestSays, run, seed, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * The guide chat's Extras block (feature 008 T021, research R8, FR-021, FR-022): the knowledge lists
 * the host's visible extras with their prices and the Extras link; hidden extras never show; copilot
 * drafts never get them (PC-10). Fictional data.
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

async function withExtras(): Promise<{ s: Seeded; link: string }> {
  const s = await seed();
  const link = publicId();
  await handle.db
    .insert(guideLink)
    .values({ workspaceId: s.workspaceId, propertyId: s.propertyId, publicId: link });
  await handle.db.insert(extra).values([
    {
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      sourceLanguage: "es",
      name: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
      price: 85,
      currency: "USD",
      position: 0,
    },
    {
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      sourceLanguage: "es",
      name: { es: "Canasta de bienvenida" },
      price: 0,
      currency: "USD",
      position: 1,
    },
    {
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      sourceLanguage: "es",
      name: { es: "Extra OcultoSecreto" },
      price: 10,
      currency: "USD",
      visible: false,
      position: 2,
    },
  ]);
  return { s, link };
}

const answerInput = (llm: { guideCalls: { method: string; input: unknown }[] }) =>
  llm.guideCalls.find((call) => call.method === "answerGuest")?.input as
    AnswerGuestInput | undefined;

describe("Extras in the guide chat (feature 008 US5)", () => {
  it("lists visible extras with prices and the Extras link", async () => {
    const { s, link } = await withExtras();
    const { deps: d, llm } = deps();
    await run(s, d, await guestSays(s, "¿Ofrecen transporte desde el aeropuerto?"));
    const knowledge = answerInput(llm)!.knowledge;
    expect(knowledge).toContain("## Extras");
    expect(knowledge).toContain(`http://127.0.0.1:3001/g/${link}/es/extras`);
    expect(knowledge).toContain("- Recogida en el aeropuerto: 85 USD");
    expect(knowledge).toContain("- Canasta de bienvenida: free");
    expect(knowledge).not.toContain("OcultoSecreto");
  });

  it("leaves the block out without visible extras, and never gives it to the copilot", async () => {
    const plain = await seed();
    const first = deps();
    await run(plain, first.deps, await guestSays(plain, "¿Ofrecen transporte?"));
    expect(answerInput(first.llm)!.knowledge).not.toContain("## Extras");

    const { s } = await withExtras();
    const [row] = await handle.db
      .insert(copilotRun)
      .values({
        workspaceId: s.workspaceId,
        propertyId: s.propertyId,
        createdBy: s.ownerId,
        message: "Do you offer an airport pickup?",
        bookingStatus: "confirmed",
      })
      .returning({ id: copilotRun.id });
    const copilot = deps();
    await runCopilotDraft(copilot.deps, { runId: row!.id, workspaceId: s.workspaceId });
    const input = answerInput(copilot.llm)!;
    expect(input.channel).toBe("platform");
    expect(input.knowledge).not.toContain("## Extras");
    expect(input.knowledge).not.toContain("/extras");
    expect(input.knowledge).not.toContain("85 USD");
  });
});
