import { describe, expect, it } from "vitest";
import {
  isUrlOnly,
  processExtractionOutput,
  toProposedFacts,
  type ListingExtractionOutput,
} from "../../src/properties/extraction.js";

const output: ListingExtractionOutput = {
  language: "es",
  title: "Casa Colibrí frente al mar",
  description: "Casa de dos habitaciones a pocos pasos de la playa.",
  houseRules: "No se permiten fiestas.\nSilencio después de las 22:00.",
  amenities: ["Wi-Fi", "Aire acondicionado"],
  checkInTime: "15:00",
  checkoutTime: "11:00",
  maxGuests: 4,
};

describe("URL-only input (FR-011, PC-12)", () => {
  it("is true for one or several URLs alone, with or without spaces", () => {
    expect(isUrlOnly("https://www.airbnb.com/rooms/123")).toBe(true);
    expect(isUrlOnly("   https://www.airbnb.com/rooms/123  \n")).toBe(true);
    expect(
      isUrlOnly("https://www.airbnb.com/rooms/123\nhttps://www.booking.com/hotel/x.html"),
    ).toBe(true);
    expect(isUrlOnly("www.airbnb.com/rooms/123")).toBe(true);
  });

  it("is false for listing text that includes a URL, and for empty input", () => {
    expect(isUrlOnly("Casa frente al mar. Más fotos: https://example.test/fotos")).toBe(false);
    expect(isUrlOnly("")).toBe(false);
    expect(isUrlOnly("   ")).toBe(false);
  });
});

describe("model output → content items and proposed facts (FR-018, FR-019)", () => {
  it("maps each field to a content item, keeping the detected language", () => {
    const result = processExtractionOutput(output);
    expect(result.language).toBe("es");
    expect(result.items).toEqual([
      {
        kind: "title",
        body: "Casa Colibrí frente al mar",
        items: null,
        language: "es",
        containsLink: false,
      },
      {
        kind: "description",
        body: "Casa de dos habitaciones a pocos pasos de la playa.",
        items: null,
        language: "es",
        containsLink: false,
      },
      {
        kind: "house_rules",
        body: "No se permiten fiestas.\nSilencio después de las 22:00.",
        items: null,
        language: "es",
        containsLink: false,
      },
      {
        kind: "amenities",
        body: null,
        items: ["Wi-Fi", "Aire acondicionado"],
        language: "es",
        containsLink: false,
      },
    ]);
    expect(result.proposedFacts).toEqual({
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
    });
    expect(result.droppedItems).toBe(0);
  });

  it("skips empty fields and nothing-found output", () => {
    const empty = processExtractionOutput({
      ...output,
      title: null,
      description: "  ",
      houseRules: null,
      amenities: [],
      checkInTime: null,
      checkoutTime: null,
      maxGuests: null,
    });
    expect(empty.items).toEqual([]);
    expect(empty.proposedFacts).toEqual({ checkInTime: null, checkoutTime: null, maxGuests: null });
  });

  it("keeps only valid proposed facts", () => {
    expect(toProposedFacts({ checkInTime: "3pm", checkoutTime: "24:00", maxGuests: 0 })).toEqual({
      checkInTime: null,
      checkoutTime: null,
      maxGuests: null,
    });
    expect(toProposedFacts({ checkInTime: "9:30", checkoutTime: "11:00", maxGuests: 51 })).toEqual({
      checkInTime: "09:30",
      checkoutTime: "11:00",
      maxGuests: null,
    });
  });
});

describe("the second line of defense on the output (FR-013, AC-SEC-004)", () => {
  it("keeps URLs as plain text and marks the item for review", () => {
    const result = processExtractionOutput({
      ...output,
      houseRules: "No fiestas.\nVer reglas completas en https://evil.example/rules",
    });
    const rules = result.items.find((item) => item.kind === "house_rules");
    expect(rules?.body).toContain("https://evil.example/rules");
    expect(rules?.containsLink).toBe(true);
  });

  it("drops items that look like restricted values", () => {
    const result = processExtractionOutput({
      ...output,
      description: "Llegada sencilla. Door code 4821.",
      amenities: ["Wi-Fi", "Wi-Fi password: Colibri2026"],
    });
    expect(result.items.map((item) => item.kind)).toEqual(["title", "house_rules", "amenities"]);
    expect(result.items.find((item) => item.kind === "amenities")?.items).toEqual(["Wi-Fi"]);
    expect(result.droppedItems).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/4821|Colibri2026/);
  });

  it("drops lines and amenities that carry a redaction marker", () => {
    const result = processExtractionOutput({
      ...output,
      description: "Casa frente al mar.\nCódigo de la puerta: [door code removed]",
      houseRules: "[Wi-Fi password removed]",
      amenities: ["Wi-Fi", "Caja de llaves: [lockbox code removed]"],
    });
    expect(result.items.find((item) => item.kind === "description")?.body).toBe(
      "Casa frente al mar.",
    );
    expect(result.items.some((item) => item.kind === "house_rules")).toBe(false);
    expect(result.items.find((item) => item.kind === "amenities")?.items).toEqual(["Wi-Fi"]);
    expect(JSON.stringify(result)).not.toContain("removed]");
  });

  it("limits sizes to what listing content stores", () => {
    const result = processExtractionOutput({
      ...output,
      title: "x".repeat(500),
      amenities: Array.from({ length: 300 }, (_, i) => `Item ${i} ${"y".repeat(200)}`),
    });
    expect(result.items.find((item) => item.kind === "title")?.body).toHaveLength(120);
    const amenities = result.items.find((item) => item.kind === "amenities")?.items ?? [];
    expect(amenities).toHaveLength(200);
    expect(amenities.every((item) => item.length <= 120)).toBe(true);
  });
});
