/**
 * Speech to text for interview voice notes (feature 003 research R8). A separate step from the
 * model that drafts: the recording never reaches that model, only the transcript, after the
 * restricted-value detector (FR-037).
 */
export interface TranscribeInput {
  /** The voice note in the uploads bucket: `uploads/{workspace_id}/{upload_id}`. */
  objectKey: string;
  /** A unique, non-secret name for the provider's job, for example the turn ID. */
  jobName: string;
  /** The type the browser recorded, for example `audio/webm`. */
  contentType: string;
}

export interface TranscribeResult {
  /** `empty`: nothing was understood (FR edge case "no speech"); `failed`: the provider failed. */
  outcome: "ok" | "empty" | "failed";
  /** The transcript. Confidential: never log it. */
  text: string | null;
  /** The language identified among Spanish and English. */
  language: "es" | "en" | null;
}

export interface SpeechToTextPort {
  transcribe(input: TranscribeInput, options?: { signal?: AbortSignal }): Promise<TranscribeResult>;
}
