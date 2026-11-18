import { createHash } from "node:crypto";
import type { SpeechToTextPort, TranscribeInput, TranscribeResult } from "./port.js";

/**
 * Transcripts for the voice-note fixtures of the end-to-end tests, keyed by the SHA-256 of the
 * audio file. Synthetic text only.
 */
export const FAKE_TRANSCRIPTS: Readonly<Record<string, string>> = {};

/** What the fake returns for audio it does not know. */
export const FAKE_DEFAULT_TRANSCRIPT =
  "El aire acondicionado se enciende con el control remoto que está en la mesa de noche.";

export interface FakeSpeechOptions {
  /** Reads the uploaded object, to look its hash up in `transcripts`. */
  read?: (objectKey: string) => Promise<Buffer>;
  transcripts?: Readonly<Record<string, string>>;
  defaultText?: string;
  /** Simulates a failure or silence. */
  outcome?: "ok" | "empty" | "failed";
}

/** The fake speech to text for development and tests (SPEECH_MODE=fake, refused in production). */
export class FakeSpeechToText implements SpeechToTextPort {
  readonly calls: TranscribeInput[] = [];

  constructor(private readonly options: FakeSpeechOptions = {}) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    this.calls.push(input);
    const outcome = this.options.outcome ?? "ok";
    if (outcome !== "ok") return { outcome, text: null, language: null };
    let text = this.options.defaultText ?? FAKE_DEFAULT_TRANSCRIPT;
    if (this.options.read) {
      const bytes = await this.options.read(input.objectKey);
      const hash = createHash("sha256").update(bytes).digest("hex");
      text = (this.options.transcripts ?? FAKE_TRANSCRIPTS)[hash] ?? text;
    }
    const spanish = /\b(el|la|los|las|con|que|está|código|puerta)\b/i.test(text);
    return { outcome: "ok", text, language: spanish ? "es" : "en" };
  }
}
