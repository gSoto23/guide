import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  createGuideForProperty,
  interviewSession,
  interviewTurn,
  membership,
  property,
  upload,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  FakeLlmAdapter,
  FakeSpeechToText,
  InProcessSandbox,
  LocalObjectStorage,
  type SpeechToTextPort,
} from "@guidesk/integrations";
import { createFileProcessor } from "@guidesk/sandbox/in-process";
import { catalogQuestion, runInterviewAnswer } from "../../src/jobs/interview-answer.js";

/**
 * The interview answer job (feature 003 T081, research R8, R11, AC-SEC-004, FR-036, FR-037): text
 * and voice paths with the fake model and fake speech, codes kept out of the model's input, the
 * voice file deleted after transcription, unreviewed `interview` items in the topic's section,
 * follow-up questions, errors that keep the question open, and timing. Fictional text only.
 */
let handle: DbHandle;
let dir: string;
let storage: LocalObjectStorage;
let sandbox: InProcessSandbox;
let workspaceId: string;
let ownerId: string;
let sessionId: string;
let guideId: string;

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(64, 7)]);

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  dir = await mkdtemp(join(tmpdir(), "guidesk-interview-job-"));
  storage = new LocalObjectStorage({ dir, uploadUrl: "http://localhost/unused" });
  sandbox = new InProcessSandbox({
    readFeed: async () => ({ error: "internal" }),
    processFile: createFileProcessor({
      storage,
      recognizer: { recognize: async () => "" },
    }),
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await handle.pool.end();
});

beforeEach(async () => {
  ownerId = `owner-${randomUUID()}`;
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
      name: "Casa Entrevista",
      guideLanguages: ["es", "en"],
      setupStatus: "ready",
      source: "manual",
    })
    .returning({ id: property.id });
  guideId = (
    await createGuideForProperty(handle.db, {
      workspaceId,
      propertyId: row!.id,
      guideLanguages: ["es", "en"],
    })
  ).guideId;
  const [session] = await handle.db
    .insert(interviewSession)
    .values({ workspaceId, guideId, startedBy: ownerId })
    .returning({ id: interviewSession.id });
  sessionId = session!.id;
});

async function textTurn(topicId: string, text: string): Promise<string> {
  const [turn] = await handle.db
    .insert(interviewTurn)
    .values({ workspaceId, sessionId, topicId, answerKind: "text", answerText: text })
    .returning({ id: interviewTurn.id });
  return turn!.id;
}

async function voiceTurn(topicId: string, bytes = OGG): Promise<{ turnId: string; key: string }> {
  const uploadId = randomUUID();
  const key = `uploads/${workspaceId}/${uploadId}`;
  await mkdir(dirname(join(dir, key)), { recursive: true });
  await writeFile(join(dir, key), bytes);
  await handle.db.insert(upload).values({
    id: uploadId,
    workspaceId,
    purpose: "voice",
    objectKey: key,
    declaredType: "audio/ogg",
    declaredSize: bytes.length,
    createdBy: ownerId,
  });
  const [turn] = await handle.db
    .insert(interviewTurn)
    .values({ workspaceId, sessionId, topicId, answerKind: "voice", uploadId })
    .returning({ id: interviewTurn.id });
  return { turnId: turn!.id, key };
}

async function turnRow(turnId: string) {
  const [row] = await handle.db.select().from(interviewTurn).where(eq(interviewTurn.id, turnId));
  return row!;
}

async function itemsOf(turnId: string) {
  const result = await handle.db.execute<{
    section: string;
    source: string;
    reviewed: boolean;
    language: string;
    topics: string[];
    text: string;
  }>(sql`
    SELECT s.kind AS section, i.source, i.reviewed_at IS NOT NULL AS reviewed,
           i.source_language AS language, i.topics, t.doc::text AS text
    FROM guide_item i
    JOIN guide_section s ON s.id = i.section_id
    JOIN guide_item_text t ON t.item_id = i.id
    WHERE i.interview_turn_id = ${turnId}`);
  return result.rows;
}

function deps(
  llm = new FakeLlmAdapter(),
  speech: SpeechToTextPort = new FakeSpeechToText({
    read: async (key) => (await storage.get(key)) ?? Buffer.alloc(0),
  }),
) {
  return { db: handle.db, llm, speech, sandbox, storage };
}

describe("the interview answer job (T081)", () => {
  it("drafts a typed answer into unreviewed interview items in the topic's section", async () => {
    const llm = new FakeLlmAdapter();
    const turnId = await textTurn(
      "appliances.ac_heating",
      "el aire acondicionado se enciende con el control blanco",
    );
    expect(await runInterviewAnswer(deps(llm), { workspaceId, turnId })).toBe("drafted");
    const items = await itemsOf(turnId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      section: "appliances",
      source: "interview",
      reviewed: false,
      language: "es",
    });
    expect(items[0]!.topics).toContain("appliances.ac_heating");
    expect(await turnRow(turnId)).toMatchObject({ status: "done", errorCode: null });
    const call = llm.guideCalls.find((entry) => entry.method === "draftAnswer");
    expect(call?.input).toMatchObject({
      language: "es",
      topicId: "appliances.ac_heating",
      sectionKind: "appliances",
      question: catalogQuestion("appliances.ac_heating", "es"),
    });
  });

  it("drafts one item when the model splits an answer on one topic (feature 021 FR-007)", async () => {
    const llm = new FakeLlmAdapter();
    const turnId = await textTurn(
      "appliances.ac_heating",
      "el control está en la mesa de noche\n\nel modo frío es el copo de nieve",
    );
    expect(await runInterviewAnswer(deps(llm), { workspaceId, turnId })).toBe("drafted");
    const items = await itemsOf(turnId);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toContain("El control está en la mesa de noche");
    expect(items[0]!.text).toContain("El modo frío es el copo de nieve");
  });

  it("never marks a photo topic covered with text (feature 020 FR-006)", async () => {
    const llm = new FakeLlmAdapter();
    const turnId = await textTurn(
      "arrival.access_photo",
      "la caja de llaves está a la derecha de la puerta, junto al medidor",
    );
    expect(await runInterviewAnswer(deps(llm), { workspaceId, turnId })).toBe("drafted");
    const items = await itemsOf(turnId);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.topics).not.toContain("arrival.access_photo");
  });

  it("transcribes a voice note, deletes it, and keeps the code out of the model (AC-SEC-004, FR-037)", async () => {
    const llm = new FakeLlmAdapter();
    const speech = new FakeSpeechToText({ defaultText: "La puerta se abre con el código 4821." });
    const { turnId, key } = await voiceTurn("arrival.access_steps");
    expect(await runInterviewAnswer(deps(llm, speech), { workspaceId, turnId })).toBe("drafted");
    expect(speech.calls).toEqual([
      expect.objectContaining({ objectKey: key, jobName: turnId, contentType: "audio/ogg" }),
    ]);
    await expect(readFile(join(dir, key))).rejects.toThrow();
    expect(JSON.stringify(llm.guideCalls)).not.toContain("4821");
    const turn = await turnRow(turnId);
    expect(turn.transcript).not.toContain("4821");
    expect(turn.redactions).toMatchObject({ door_code: 1 });
    const items = await itemsOf(turnId);
    expect(items[0]?.section).toBe("arrival");
    expect(JSON.stringify(items)).not.toContain("4821");
  });

  it("never sends a typed code to the model (AC-SEC-004)", async () => {
    const llm = new FakeLlmAdapter();
    // The API stores typed answers after the detector; the job checks the output again.
    const turnId = await textTurn(
      "arrival.access_steps",
      "La caja de llaves está junto a la puerta.",
    );
    await runInterviewAnswer(deps(llm), { workspaceId, turnId });
    expect(JSON.stringify(llm.guideCalls)).not.toMatch(/\b\d{4}\b/);
  });

  it("stores the model's follow-up and uses it as the next question for the topic (R11)", async () => {
    const llm = new FakeLlmAdapter();
    const original = llm.draftAnswer.bind(llm);
    llm.draftAnswer = async (input, options) => {
      const result = await original(input, options);
      return result.result
        ? { ...result, result: { ...result.result, followUp: "¿Dónde está el control remoto?" } }
        : result;
    };
    const first = await textTurn("appliances.ac_heating", "hay aire acondicionado");
    await runInterviewAnswer(deps(llm), { workspaceId, turnId: first });
    expect((await turnRow(first)).followUp).toBe("¿Dónde está el control remoto?");
    const second = await textTurn("appliances.ac_heating", "en la mesa de noche");
    await runInterviewAnswer(deps(llm), { workspaceId, turnId: second });
    const calls = llm.guideCalls.filter((entry) => entry.method === "draftAnswer");
    expect((calls[1]?.input as { question: string }).question).toBe(
      "¿Dónde está el control remoto?",
    );
  });

  it("keeps the question open when nothing is understood or the transcription fails", async () => {
    const silent = await voiceTurn("checkout.steps");
    expect(
      await runInterviewAnswer(deps(undefined, new FakeSpeechToText({ outcome: "empty" })), {
        workspaceId,
        turnId: silent.turnId,
      }),
    ).toBe("not_understood");
    expect(await turnRow(silent.turnId)).toMatchObject({
      status: "failed",
      errorCode: "not_understood",
    });

    const broken = await voiceTurn("checkout.steps");
    expect(
      await runInterviewAnswer(deps(undefined, new FakeSpeechToText({ outcome: "failed" })), {
        workspaceId,
        turnId: broken.turnId,
      }),
    ).toBe("transcription_failed");
    await expect(readFile(join(dir, broken.key))).rejects.toThrow();

    const notAudio = await voiceTurn("checkout.steps", Buffer.from("%PDF-1.7 not audio at all"));
    expect(await runInterviewAnswer(deps(), { workspaceId, turnId: notAudio.turnId })).toBe(
      "unsupported_type",
    );

    const refused = await textTurn("checkout.steps", "deja las llaves en la mesa");
    expect(
      await runInterviewAnswer(deps(new FakeLlmAdapter({ guideOutcome: "refused" })), {
        workspaceId,
        turnId: refused,
      }),
    ).toBe("not_understood");
    expect(await itemsOf(refused)).toHaveLength(0);
  });

  it("drafts text within 15 seconds and voice within 30 with simulated latency (FR-036)", async () => {
    const slowLlm = new FakeLlmAdapter({ delayMs: 2_000 });
    const text = await textTurn("checkout.steps", "deja las llaves en la mesa del comedor");
    let started = performance.now();
    await runInterviewAnswer(deps(slowLlm), { workspaceId, turnId: text });
    expect(performance.now() - started).toBeLessThan(15_000);

    const fake = new FakeSpeechToText();
    const slowSpeech: SpeechToTextPort = {
      transcribe: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        return fake.transcribe(input);
      },
    };
    const { turnId } = await voiceTurn("appliances.ac_heating");
    started = performance.now();
    expect(await runInterviewAnswer(deps(slowLlm, slowSpeech), { workspaceId, turnId })).toBe(
      "drafted",
    );
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 40_000);

  it("skips a turn that is not queued, and waits for one that is not visible yet", async () => {
    const turnId = await textTurn("checkout.steps", "deja las llaves");
    await handle.db
      .update(interviewTurn)
      .set({ status: "done" })
      .where(eq(interviewTurn.id, turnId));
    expect(await runInterviewAnswer(deps(), { workspaceId, turnId })).toBe("skipped");
    await expect(runInterviewAnswer(deps(), { workspaceId, turnId: randomUUID() })).rejects.toThrow(
      "interview turn not ready",
    );
  });
});
