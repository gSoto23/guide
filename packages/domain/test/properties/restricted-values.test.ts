import { describe, expect, it } from "vitest";
import {
  containsRestrictedValue,
  maskRestrictedValues,
  unmaskRestrictedValues,
  REDACTION_MARKERS,
  redactRestrictedValues,
  RESTRICTED_VALUE_KINDS,
  type RestrictedValueKind,
} from "../../src/properties/restricted-values.js";
import {
  CODE_SNIPPETS,
  LOOK_ALIKE_SNIPPETS,
  RESTRICTED_VALUE_CORPUS,
  type CorpusEntry,
} from "./restricted-values.corpus.js";

function expectedCounts(entry: CorpusEntry): Partial<Record<RestrictedValueKind, number>> {
  const counts: Partial<Record<RestrictedValueKind, number>> = {};
  for (const code of entry.codes) {
    counts[code.kind] = (counts[code.kind] ?? 0) + 1;
  }
  return counts;
}

describe("restricted-value corpus (T010, R4)", () => {
  it("holds at least 60 labeled snippets in Spanish and English, codes and look-alikes", () => {
    expect(RESTRICTED_VALUE_CORPUS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(RESTRICTED_VALUE_CORPUS.map((entry) => entry.id)).size).toBe(
      RESTRICTED_VALUE_CORPUS.length,
    );
    for (const lang of ["es", "en"] as const) {
      expect(CODE_SNIPPETS.filter((entry) => entry.lang === lang).length).toBeGreaterThanOrEqual(
        20,
      );
      expect(LOOK_ALIKE_SNIPPETS.filter((entry) => entry.lang === lang).length).toBeGreaterThan(5);
    }
    expect(CODE_SNIPPETS.every((entry) => entry.codes.length > 0)).toBe(true);
    expect(LOOK_ALIKE_SNIPPETS.every((entry) => entry.codes.length === 0)).toBe(true);
    const labeledKinds = new Set(CODE_SNIPPETS.flatMap((entry) => entry.codes.map((c) => c.kind)));
    expect([...labeledKinds].sort()).toEqual([...RESTRICTED_VALUE_KINDS].sort());
  });

  it("finds every labeled value: recall is 100%", () => {
    const missed: string[] = [];
    let total = 0;
    for (const entry of CODE_SNIPPETS) {
      const result = redactRestrictedValues(entry.text);
      for (const code of entry.codes) {
        total += 1;
        if (
          result.text.includes(code.value) ||
          !result.matches.some((m) => m.value === code.value)
        ) {
          missed.push(`${entry.id}: ${code.value}`);
        }
      }
    }
    expect(total).toBeGreaterThanOrEqual(80);
    expect(missed).toEqual([]);
  });

  it.each(CODE_SNIPPETS.map((entry) => [entry.id, entry] as const))(
    "removes the codes in %s, with the right kinds and markers",
    (_id, entry) => {
      const result = redactRestrictedValues(entry.text);
      expect(result.matches.map(({ kind, value }) => ({ value, kind }))).toEqual(entry.codes);
      expect(result.counts).toEqual(expectedCounts(entry));
      for (const code of entry.codes) {
        expect(result.text).not.toContain(code.value);
        expect(result.text).toContain(REDACTION_MARKERS[code.kind]);
      }
      for (const keep of entry.keep) {
        expect(result.text).toContain(keep);
      }
    },
  );

  it.each(LOOK_ALIKE_SNIPPETS.map((entry) => [entry.id, entry] as const))(
    "keeps the look-alikes in %s",
    (_id, entry) => {
      const result = redactRestrictedValues(entry.text);
      expect(result).toEqual({ text: entry.text, counts: {}, matches: [] });
      expect(containsRestrictedValue(entry.text)).toBe(false);
      for (const keep of entry.keep) {
        expect(result.text).toContain(keep);
      }
    },
  );

  it("reports offsets in the original text", () => {
    for (const entry of RESTRICTED_VALUE_CORPUS) {
      for (const match of redactRestrictedValues(entry.text).matches) {
        expect(entry.text.slice(match.start, match.end)).toBe(match.value);
      }
    }
  });

  it("is idempotent: redacting redacted text changes nothing", () => {
    for (const entry of RESTRICTED_VALUE_CORPUS) {
      const once = redactRestrictedValues(entry.text).text;
      expect(redactRestrictedValues(once)).toEqual({ text: once, counts: {}, matches: [] });
      expect(containsRestrictedValue(once)).toBe(false);
    }
  });
});

describe("redactRestrictedValues (T017, FR-012, FR-013, FR-031)", () => {
  it("uses one English marker per kind", () => {
    expect(RESTRICTED_VALUE_KINDS).toEqual([
      "door_code",
      "gate_code",
      "lockbox_code",
      "alarm_code",
      "wifi_password",
      "other",
    ]);
    expect(REDACTION_MARKERS).toEqual({
      door_code: "[door code removed]",
      gate_code: "[gate code removed]",
      lockbox_code: "[lockbox code removed]",
      alarm_code: "[alarm code removed]",
      wifi_password: "[Wi-Fi password removed]",
      other: "[code removed]",
    });
  });

  it.each([
    ["door code 4821", "door code [door code removed]"],
    ["the code is 4821", "the code is [code removed]"],
    ["código de la puerta: 4821#", "código de la puerta: [door code removed]"],
    ["PIN 0000", "PIN [code removed]"],
    ["gate code 1234*", "gate code [gate code removed]"],
    ["lockbox: A1B2", "lockbox: [lockbox code removed]"],
    ["alarm 9087", "alarm [alarm code removed]"],
    [
      "Wi-Fi: CasaColibri / pass: Colibri2026",
      "Wi-Fi: CasaColibri / pass: [Wi-Fi password removed]",
    ],
    ["clave del wifi Colibri2026", "clave del wifi [Wi-Fi password removed]"],
    ["Door code:\n4821", "Door code:\n[door code removed]"],
    ["Red: CasaColibri_5G", "Red: CasaColibri_5G"],
    ["Network name: Colibri-Guest", "Network name: Colibri-Guest"],
  ])("redacts %j", (input, expected) => {
    expect(redactRestrictedValues(input).text).toBe(expected);
  });

  it("reports each match with its kind and original offsets, and counts per kind", () => {
    const text =
      "Puerta 4821, portón 1234*.\nWi-Fi: CasaColibri\nClave: Colibri2026\nPuerta trasera 9999";
    const result = redactRestrictedValues(text);
    expect(result.matches).toEqual([
      { kind: "door_code", value: "4821", start: 7, end: 11 },
      { kind: "gate_code", value: "1234*", start: 20, end: 25 },
      { kind: "wifi_password", value: "Colibri2026", start: 53, end: 64 },
      { kind: "door_code", value: "9999", start: 80, end: 84 },
    ]);
    expect(result.counts).toEqual({ door_code: 2, gate_code: 1, wifi_password: 1 });
    expect(result.text).toBe(
      "Puerta [door code removed], portón [gate code removed].\nWi-Fi: CasaColibri\nClave: [Wi-Fi password removed]\nPuerta trasera [door code removed]",
    );
  });

  it("ignores case and accents, including decomposed accents", () => {
    expect(redactRestrictedValues("CÓDIGO DE LA PUERTA: 4821").text).toBe(
      "CÓDIGO DE LA PUERTA: [door code removed]",
    );
    expect(redactRestrictedValues("codigo del porton 4821").counts).toEqual({ gate_code: 1 });
    expect(redactRestrictedValues("Contrasen\u0303a del wifi: Colibri2026").counts).toEqual({
      wifi_password: 1,
    });
  });

  it("removes long Wi-Fi passwords that exceed the 12-character code length", () => {
    expect(redactRestrictedValues("Wi-Fi password: CasaColibriVerde2026!").text).toBe(
      "Wi-Fi password: [Wi-Fi password removed]",
    );
  });

  it("does not take letters-only words after a password keyword for a password", () => {
    expect(containsRestrictedValue("Wi-Fi password: provided at check-in")).toBe(false);
    expect(containsRestrictedValue("Clave del wifi: pregunte en recepción")).toBe(false);
  });

  it("keeps ordinary listing text untouched", () => {
    const text =
      "Casa Colibrí frente al mar. Casa de dos habitaciones a pocos pasos de la playa.\nNo se permiten fiestas.\nSilencio después de las 22:00.\nWi-Fi, aire acondicionado.";
    expect(redactRestrictedValues(text)).toEqual({ text, counts: {}, matches: [] });
  });

  it("handles empty text and text that holds only markers", () => {
    expect(redactRestrictedValues("")).toEqual({ text: "", counts: {}, matches: [] });
    const markers = Object.values(REDACTION_MARKERS).join(" ");
    expect(redactRestrictedValues(markers)).toEqual({ text: markers, counts: {}, matches: [] });
    expect(containsRestrictedValue(markers)).toBe(false);
  });

  it("containsRestrictedValue is true exactly when redaction removes something", () => {
    expect(containsRestrictedValue("Door code 4821")).toBe(true);
    expect(containsRestrictedValue("Check-in 15:00, 3 habitaciones, $120 por noche")).toBe(false);
  });
});

describe("feature 003 extensions (T009, research R5)", () => {
  it("grows the corpus to at least 120 snippets", () => {
    expect(RESTRICTED_VALUE_CORPUS.length).toBeGreaterThanOrEqual(120);
  });

  it("masks values with numbered placeholders and puts them back unchanged", () => {
    const text = "El código de la puerta es 4821 y la clave del wifi: Colibri2026.";
    const masked = maskRestrictedValues(text);
    expect(masked.text).toBe("El código de la puerta es {{R1}} y la clave del wifi: {{R2}}.");
    expect(masked.values).toEqual(["4821", "Colibri2026"]);
    expect(masked.counts).toEqual({ door_code: 1, wifi_password: 1 });
    const translated = "The door code is {{R1}} and the Wi-Fi password: {{R2}}.";
    expect(unmaskRestrictedValues(translated, masked.values)).toBe(
      "The door code is 4821 and the Wi-Fi password: Colibri2026.",
    );
  });

  it("leaves text without values untouched and unknown placeholders in place", () => {
    expect(maskRestrictedValues("Check-in at 3 pm.")).toEqual({
      text: "Check-in at 3 pm.",
      values: [],
      counts: {},
    });
    expect(unmaskRestrictedValues("Code {{R3}}", ["4821"])).toBe("Code {{R3}}");
  });

  it("masks every labeled value of the corpus", () => {
    for (const entry of CODE_SNIPPETS) {
      const masked = maskRestrictedValues(entry.text);
      for (const code of entry.codes) {
        expect(masked.text, entry.id).not.toContain(code.value);
      }
      expect(unmaskRestrictedValues(masked.text, masked.values), entry.id).toBe(entry.text);
    }
  });
});
