import { describe, expect, it } from "vitest";
import {
  afterHostReview,
  afterKeep,
  afterSourceChange,
  afterTranslateAgain,
  afterTranslation,
  afterTranslationFailure,
  needsTranslation,
} from "../../src/guides/translation-state.js";

/** Translation states (feature 003 data model §7, FR-044 to FR-046, T013). */
describe("translation states", () => {
  const machine = { origin: "machine" as const, state: "current" as const };
  const reviewed = { origin: "reviewed" as const, state: "current" as const };

  it("makes machine text stale when the source changes, and reviewed text out of date", () => {
    expect(afterSourceChange(machine)).toMatchObject({ origin: "machine", state: "stale" });
    expect(afterSourceChange(reviewed)).toMatchObject({ origin: "reviewed", state: "out_of_date" });
    expect(afterSourceChange({ origin: "reviewed", state: "out_of_date" })).toMatchObject({
      state: "out_of_date",
    });
    expect(afterSourceChange({ origin: "machine", state: "pending" })).toMatchObject({
      state: "stale",
    });
    expect(afterSourceChange({ origin: "machine", state: "failed" })).toMatchObject({
      state: "stale",
    });
  });

  it("waits on the limit and an unavailable model, and fails on token mismatch", () => {
    const stale = { origin: "machine" as const, state: "stale" as const };
    expect(afterTranslationFailure(stale, "ai_limit")).toEqual({
      origin: "machine",
      state: "pending",
      pendingReason: "ai_limit",
    });
    expect(afterTranslationFailure(stale, "ai_unavailable")).toMatchObject({ state: "pending" });
    expect(afterTranslationFailure(stale, "tokens_mismatch")).toMatchObject({ state: "failed" });
  });

  it("follows the host's actions", () => {
    expect(afterTranslation()).toMatchObject({ origin: "machine", state: "current" });
    expect(afterHostReview()).toMatchObject({ origin: "reviewed", state: "current" });
    expect(afterKeep({ origin: "reviewed", state: "out_of_date" })).toMatchObject({
      origin: "reviewed",
      state: "current",
    });
    expect(afterKeep(machine)).toEqual(machine);
    expect(afterTranslateAgain({ origin: "reviewed", state: "out_of_date" })).toMatchObject({
      state: "stale",
    });
  });

  it("translates only stale and pending texts", () => {
    expect(needsTranslation({ state: "stale" })).toBe(true);
    expect(needsTranslation({ state: "pending" })).toBe(true);
    for (const state of ["current", "out_of_date", "failed"] as const) {
      expect(needsTranslation({ state })).toBe(false);
    }
  });
});
