import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DeleteTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
  type MediaFormat,
} from "@aws-sdk/client-transcribe";
import type { SpeechToTextPort, TranscribeInput, TranscribeResult } from "./port.js";

/** The containers browsers record (research R8), as Transcribe names them. */
const FORMATS: Record<string, MediaFormat> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
};

/** Spanish and English only (FR-037); the identified code maps back to the guide language. */
const LANGUAGE_OPTIONS = ["es-US", "en-US"] as const;

export interface TranscribeSpeechOptions {
  /** The uploads bucket: voice notes live under `uploads/`, transcripts under `transcripts/`. */
  bucket: string;
  transcribe?: Pick<TranscribeClient, "send">;
  s3?: Pick<S3Client, "send">;
  /** How often to look at the job; 1.5 seconds by default. */
  pollIntervalMs?: number;
  /** When to give up; 60 seconds by default (FR-036 asks for the draft within 30). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** A job name Transcribe accepts, from a non-secret ID such as the turn's. */
function jobNameOf(id: string): string {
  return `guidesk-${id.replace(/[^0-9A-Za-z._-]/g, "-")}`.slice(0, 200);
}

/**
 * Amazon Transcribe batch jobs (feature 003 research R8): starts a job with language
 * identification limited to Spanish and English, waits for it, reads the transcript from the
 * uploads bucket, and deletes the job and its output whatever happens. The transcript is
 * confidential: it is never logged or put in an error.
 */
export class TranscribeSpeechToText implements SpeechToTextPort {
  private readonly transcribeClient: Pick<TranscribeClient, "send">;
  private readonly s3: Pick<S3Client, "send">;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: TranscribeSpeechOptions) {
    this.transcribeClient = options.transcribe ?? new TranscribeClient({ region: "us-east-1" });
    this.s3 = options.s3 ?? new S3Client({ region: "us-east-1" });
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async transcribe(
    input: TranscribeInput,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<TranscribeResult> {
    const format = FORMATS[input.contentType.split(";")[0]!.trim().toLowerCase()];
    if (!format) return { outcome: "failed", text: null, language: null };
    const jobName = jobNameOf(input.jobName);
    const outputKey = `transcripts/${jobName}.json`;
    try {
      await this.transcribeClient.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          Media: { MediaFileUri: `s3://${this.options.bucket}/${input.objectKey}` },
          MediaFormat: format,
          IdentifyLanguage: true,
          LanguageOptions: [...LANGUAGE_OPTIONS],
          OutputBucketName: this.options.bucket,
          OutputKey: outputKey,
        }),
      );
      const deadline = Date.now() + (this.options.timeoutMs ?? 60_000);
      for (;;) {
        if (signal?.aborted) return { outcome: "failed", text: null, language: null };
        const { TranscriptionJob: job } = await this.transcribeClient.send(
          new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
        );
        const status = job?.TranscriptionJobStatus;
        if (status === "FAILED") return { outcome: "failed", text: null, language: null };
        if (status === "COMPLETED") {
          const text = await this.readTranscript(outputKey);
          const language = job?.LanguageCode?.startsWith("es")
            ? "es"
            : job?.LanguageCode?.startsWith("en")
              ? "en"
              : null;
          if (!text) return { outcome: "empty", text: null, language };
          return { outcome: "ok", text, language };
        }
        if (Date.now() >= deadline) return { outcome: "failed", text: null, language: null };
        await this.sleep(this.options.pollIntervalMs ?? 1_500);
      }
    } catch {
      // Provider errors carry no transcript; the turn shows "type instead" (FR-037).
      return { outcome: "failed", text: null, language: null };
    } finally {
      await this.transcribeClient
        .send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }))
        .catch(() => undefined);
      await this.s3
        .send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: outputKey }))
        .catch(() => undefined);
    }
  }

  private async readTranscript(key: string): Promise<string> {
    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    const body = await object.Body?.transformToString("utf-8");
    if (!body) return "";
    const parsed = JSON.parse(body) as {
      results?: { transcripts?: { transcript?: string }[] };
    };
    return (parsed.results?.transcripts ?? [])
      .map((entry) => entry.transcript ?? "")
      .join(" ")
      .trim();
  }
}
