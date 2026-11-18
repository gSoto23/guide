import { describe, expect, it } from "vitest";
import {
  guideAiDailyLimit,
  guideAiLimitKey,
  guideAiLimitResetsAt,
  mediaStorageLimitBytes,
  revealLimitKey,
} from "../../src/guides/limits.js";

/** Guide limits (feature 003 FR-064, FR-065, FR-018, T016). */
describe("guide limits", () => {
  it("allows 50 AI requests per allowed property per day, at least 100, unless overridden", () => {
    expect(guideAiDailyLimit(2)).toBe(100);
    expect(guideAiDailyLimit(40)).toBe(2000);
    expect(guideAiDailyLimit(40, 300)).toBe(300);
  });

  it("allows 1 GB of media per allowed property, unless overridden in MB", () => {
    expect(mediaStorageLimitBytes(2)).toBe(2 * 1024 * 1024 * 1024);
    expect(mediaStorageLimitBytes(2, 500)).toBe(500 * 1024 * 1024);
  });

  it("counts per UTC day and resets at the next UTC midnight", () => {
    const now = new Date("2026-11-17T23:59:00Z");
    expect(guideAiLimitKey("ws", now)).toBe("guide-ai:ws:2026-11-17");
    expect(guideAiLimitResetsAt(now).toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });

  it("counts reveals per member and workspace", () => {
    expect(revealLimitKey("ws", "user")).toBe("reveal:ws:user");
  });
});
