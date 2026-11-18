import { describe, expect, it } from "vitest";
import {
  decideAfterAnswer,
  decideBeforeAnswer,
  pointerSectionKind,
  type Classification,
} from "../../src/agent/policy.js";

const base: Classification = {
  language: "en",
  topic: "checkout",
  escalation: "none",
  sentiment: "neutral",
  injection: false,
};

describe("policy before the answer (feature 005 research R5)", () => {
  it("holds every mandatory escalation, with the emergency card for emergencies", () => {
    expect(decideBeforeAnswer({ ...base, escalation: "emergency" }, false)).toEqual({
      kind: "hold",
      reason: "emergency",
      emergency: true,
    });
    for (const escalation of [
      "malfunction",
      "complaint",
      "money",
      "reservation_change",
      "legal",
    ] as const) {
      expect(decideBeforeAnswer({ ...base, escalation }, false)).toEqual({
        kind: "hold",
        reason: escalation,
        emergency: false,
      });
    }
  });

  it("treats very negative sentiment as a complaint, even under budget", () => {
    expect(decideBeforeAnswer({ ...base, sentiment: "very_negative" }, true)).toMatchObject({
      kind: "hold",
      reason: "complaint",
    });
  });

  it("points to the section for sensitive requests without spending the budget", () => {
    expect(decideBeforeAnswer({ ...base, escalation: "sensitive_request" }, true)).toEqual({
      kind: "pointer",
    });
    expect(pointerSectionKind("wifi")).toBe("wifi");
    expect(pointerSectionKind("arrival")).toBe("arrival");
    expect(pointerSectionKind("other")).toBe("arrival");
  });

  it("holds when over budget, greets greetings, and otherwise answers", () => {
    expect(decideBeforeAnswer(base, true)).toEqual({
      kind: "hold",
      reason: "limit",
      emergency: false,
    });
    expect(decideBeforeAnswer({ ...base, topic: "greeting" }, false)).toEqual({ kind: "greeting" });
    expect(decideBeforeAnswer(base, false)).toEqual({ kind: "answer" });
  });
});

describe("policy after the answer", () => {
  it("drafts when not confident, in draft mode, or when a check fails; sends otherwise", () => {
    expect(decideAfterAnswer({ answerable: false, needsHost: false }, "auto", true)).toEqual({
      kind: "draft",
      reason: "not_confident",
    });
    expect(decideAfterAnswer({ answerable: true, needsHost: true }, "auto", true)).toEqual({
      kind: "draft",
      reason: "not_confident",
    });
    expect(decideAfterAnswer({ answerable: true, needsHost: false }, "draft", true)).toEqual({
      kind: "draft",
      reason: "draft_ready",
    });
    expect(decideAfterAnswer({ answerable: true, needsHost: false }, "auto", false)).toEqual({
      kind: "draft",
      reason: "check_failed",
    });
    expect(decideAfterAnswer({ answerable: true, needsHost: false }, "auto", true)).toEqual({
      kind: "send",
    });
  });
});
