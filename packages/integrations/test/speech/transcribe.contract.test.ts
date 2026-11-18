import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  DeleteTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
} from "@aws-sdk/client-transcribe";
import { describe, expect, it } from "vitest";
import { TranscribeSpeechToText } from "../../src/speech/transcribe.adapter.js";

/**
 * The Transcribe adapter (feature 003 T082, research R8) against recorded command shapes: start
 * with language identification limited to es-US and en-US, poll, read the result from the
 * uploads bucket, report failures and silence, and delete the job and the output every time.
 * The transcript is synthetic.
 */
const TRANSCRIPT = "El aire acondicionado se enciende con el control remoto.";

type Command = { constructor: { name: string }; input: Record<string, unknown> };

function clients(
  statuses: ("IN_PROGRESS" | "COMPLETED" | "FAILED")[],
  options: { transcript?: string; language?: string; startFails?: boolean } = {},
) {
  const sent: Command[] = [];
  let polls = 0;
  const transcribe = {
    send: async (command: Command) => {
      sent.push(command);
      if (command instanceof StartTranscriptionJobCommand && options.startFails) {
        throw new Error("ThrottlingException");
      }
      if (command instanceof GetTranscriptionJobCommand) {
        const status = statuses[Math.min(polls, statuses.length - 1)];
        polls += 1;
        return {
          TranscriptionJob: { TranscriptionJobStatus: status, LanguageCode: options.language },
        };
      }
      return {};
    },
  };
  const s3 = {
    send: async (command: Command) => {
      sent.push(command);
      if (command instanceof GetObjectCommand) {
        const body = JSON.stringify({
          results: { transcripts: [{ transcript: options.transcript ?? TRANSCRIPT }] },
        });
        return { Body: { transformToString: async () => body } };
      }
      return {};
    },
  };
  return { sent, transcribe, s3 };
}

function adapter(mocks: ReturnType<typeof clients>) {
  return new TranscribeSpeechToText({
    bucket: "guidesk-uploads-test",
    transcribe: mocks.transcribe as never,
    s3: mocks.s3 as never,
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    sleep: async () => undefined,
  });
}

const input = {
  objectKey: "uploads/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002",
  jobName: "00000000-0000-4000-8000-000000000003",
  contentType: "audio/webm;codecs=opus",
};

describe("the Transcribe adapter (T082)", () => {
  it("starts a job limited to Spanish and English, polls, and reads the transcript", async () => {
    const mocks = clients(["IN_PROGRESS", "COMPLETED"], { language: "es-US" });
    const result = await adapter(mocks).transcribe(input);
    expect(result).toEqual({ outcome: "ok", text: TRANSCRIPT, language: "es" });
    const start = mocks.sent.find((command) => command instanceof StartTranscriptionJobCommand)!;
    expect(start.input).toMatchObject({
      TranscriptionJobName: "guidesk-00000000-0000-4000-8000-000000000003",
      Media: { MediaFileUri: `s3://guidesk-uploads-test/${input.objectKey}` },
      MediaFormat: "webm",
      IdentifyLanguage: true,
      LanguageOptions: ["es-US", "en-US"],
      OutputBucketName: "guidesk-uploads-test",
      OutputKey: "transcripts/guidesk-00000000-0000-4000-8000-000000000003.json",
    });
    expect(
      mocks.sent.filter((command) => command instanceof GetTranscriptionJobCommand),
    ).toHaveLength(2);
  });

  it("maps English and the browsers' containers", async () => {
    for (const [contentType, format] of [
      ["audio/mp4", "mp4"],
      ["audio/ogg", "ogg"],
      ["audio/x-m4a", "m4a"],
    ] as const) {
      const mocks = clients(["COMPLETED"], { language: "en-US" });
      const result = await adapter(mocks).transcribe({ ...input, contentType });
      expect(result.language).toBe("en");
      const start = mocks.sent.find((command) => command instanceof StartTranscriptionJobCommand)!;
      expect(start.input.MediaFormat).toBe(format);
    }
  });

  it("reports failure, silence, a timeout, and an unknown type without a transcript", async () => {
    expect(await adapter(clients(["FAILED"])).transcribe(input)).toEqual({
      outcome: "failed",
      text: null,
      language: null,
    });
    expect(
      await adapter(clients(["COMPLETED"], { transcript: "  ", language: "es-US" })).transcribe(
        input,
      ),
    ).toMatchObject({ outcome: "empty", text: null });
    expect(await adapter(clients(["IN_PROGRESS"])).transcribe(input)).toMatchObject({
      outcome: "failed",
    });
    const unknown = clients(["COMPLETED"]);
    expect(await adapter(unknown).transcribe({ ...input, contentType: "video/x-msvideo" })).toEqual(
      { outcome: "failed", text: null, language: null },
    );
    expect(unknown.sent).toHaveLength(0);
    expect(await adapter(clients([], { startFails: true })).transcribe(input)).toMatchObject({
      outcome: "failed",
    });
  });

  it("deletes the job and its output after success and after failure", async () => {
    for (const statuses of [["COMPLETED"], ["FAILED"]] as const) {
      const mocks = clients([...statuses], { language: "es-US" });
      await adapter(mocks).transcribe(input);
      const deleteJob = mocks.sent.find(
        (command) => command instanceof DeleteTranscriptionJobCommand,
      );
      const deleteOutput = mocks.sent.find((command) => command instanceof DeleteObjectCommand);
      expect(deleteJob?.input).toEqual({
        TranscriptionJobName: "guidesk-00000000-0000-4000-8000-000000000003",
      });
      expect(deleteOutput?.input).toEqual({
        Bucket: "guidesk-uploads-test",
        Key: "transcripts/guidesk-00000000-0000-4000-8000-000000000003.json",
      });
    }
  });
});
