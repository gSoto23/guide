import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  return JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  ) as Catalog;
}

function keys(catalog: Catalog, prefix = ""): string[] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? keys(value as Catalog, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("message catalogs (constitution, Principle IX)", () => {
  it("have the same keys in Spanish and English", () => {
    expect(keys(load("es")).sort()).toEqual(keys(load("en")).sort());
  });

  it("cover every API error code", () => {
    const codes = [
      "unauthenticated",
      "forbidden",
      "step_up_required",
      "mfa_enrollment_required",
      "not_found",
      "conflict",
      "gone",
      "validation_failed",
      "rate_limited",
      "internal_error",
      // Feature 003 (contracts/http-api.md, Feature-specific errors).
      "section_changed",
      "not_ready_to_publish",
      "locked_field_referenced",
      "interview_active",
      "section_limit",
      "item_limit",
      "text_too_long",
      "invalid_document",
      "benefit_required",
      "wifi_only",
      "shared_block_limit",
      "storage_limit_reached",
      "ai_limit_reached",
      "reveal_limit_reached",
      // Feature 002 (contracts/http-api.md, Feature-specific errors).
      "plan_limit_reached",
      "workspace_pending_deletion",
      "feed_limit_reached",
      "duplicate_feed",
      "refresh_too_soon",
      "confirmation_mismatch",
      "feed_rejected",
      "invalid_credential",
      "extraction_limit_reached",
    ];
    const errorKeys = keys(load("es")).filter((k) => k.startsWith("errors."));
    for (const code of codes) expect(errorKeys).toContain(`errors.${code}`);
  });
});
