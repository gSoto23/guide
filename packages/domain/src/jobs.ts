/**
 * Worker queues shared by the API (which sends jobs) and the worker (which runs them)
 * (feature 002 research R13). Payloads carry IDs only, never restricted values.
 */
export const JOB_QUEUES = {
  extractionRun: "extraction.run",
  csvValidate: "csv.validate",
  csvImport: "csv.import",
  pmsImport: "pms.import",
  pmsRefresh: "pms.refresh",
  pmsListings: "pms.listings",
  pmsRevoke: "pms.revoke",
  calendarRefresh: "calendar.refresh",
  retentionDaily: "retention.daily",
  propertiesPurge: "properties.purge",
  // Feature 003 (research R15).
  guideDraft: "guide.draft",
  guideTranslate: "guide.translate",
  interviewAnswer: "interview.answer",
  guideDocument: "guide.document",
  mediaProcess: "media.process",
  sharedBlockPublish: "shared-block.publish",
  mediaCopy: "media.copy",
  // Feature 005 (research R2, R12).
  chatReply: "chat.reply",
  agentCostCheck: "agent.cost-check",
  // Feature 007 (research R7, R12).
  assistantTest: "assistant.test",
  chatQuietDigest: "chat.quiet-digest",
} as const;

export interface CalendarRefreshJob {
  feedId: string;
  workspaceId: string;
}

/** "Refresh now" runs ahead of scheduled refreshes (SC-006). */
export const REFRESH_NOW_PRIORITY = 10;

/**
 * pg-boss queue policies. `stately` keeps at most one queued and one active job per singleton
 * key, so one feed or connection never refreshes twice at the same time (research R8). The API
 * and the worker both create queues with these policies, whichever starts first.
 */
export const QUEUE_POLICIES: Partial<
  Record<string, "standard" | "stately" | "singleton" | "short">
> = {
  [JOB_QUEUES.calendarRefresh]: "stately",
  [JOB_QUEUES.pmsRefresh]: "stately",
  [JOB_QUEUES.pmsImport]: "singleton",
  // One queued and one active translation per section and language (feature 003 research R7).
  [JOB_QUEUES.guideTranslate]: "stately",
  [JOB_QUEUES.guideDraft]: "stately",
  // One queued and one active reply per conversation (feature 005 research R2).
  [JOB_QUEUES.chatReply]: "stately",
  // The every-minute digest never overlaps itself (feature 007 research R7).
  [JOB_QUEUES.chatQuietDigest]: "singleton",
};

export interface ExtractionRunJob {
  extractionId: string;
  workspaceId: string;
}

/** Feature 003 job payloads (research R15). IDs only, never content or restricted values. */
export interface GuideDraftJob {
  guideId: string;
  workspaceId: string;
  /** Redraft one section from the listing content (FR-007); the whole draft when absent. */
  sectionId?: string;
  /** The API already took this request from the daily AI limit (redraft). */
  limitTaken?: boolean;
}

export interface GuideTranslateJob {
  workspaceId: string;
  /** A property section, or a shared block. */
  sectionId?: string;
  sharedBlockId?: string;
  language: "es" | "en";
}

/** Translation waits this long after the last save, so autosave does not translate every keystroke. */
export const TRANSLATE_DEBOUNCE_SECONDS = 20;

export interface InterviewAnswerJob {
  workspaceId: string;
  turnId: string;
}

export interface GuideDocumentJob {
  workspaceId: string;
  documentId: string;
}

export interface MediaProcessJob {
  workspaceId: string;
  mediaId: string;
}

/** A duplicated property's media, copied to the new object's own keys (feature 003 FR-067). */
export interface MediaCopyJob {
  workspaceId: string;
  /** The new media object, in `processing` until its objects are copied. */
  mediaId: string;
  sourceMediaId: string;
}

export interface SharedBlockPublishJob {
  workspaceId: string;
  sharedBlockId: string;
  /** `published` after a publish, `deleted` after a delete. */
  change: "published" | "deleted";
}

/** Feature 005: one reply run per conversation (research R2). IDs only, never message text. */
export interface ChatReplyJob {
  workspaceId: string;
  conversationId: string;
  /** The guest message to answer; the job answers the latest unanswered one. */
  messageId: string;
}

/** The worker polls the reply queue this often (research R2). */
export const CHAT_REPLY_POLL_SECONDS = 0.5;

/** Feature 007 research R12: run one "test the assistant" question. */
export interface AssistantTestJob {
  testId: string;
  workspaceId: string;
}
