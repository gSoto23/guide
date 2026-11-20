import { describe, expect, it } from "vitest";
import { initialsOf } from "../lib/initials";

/** Initials avatars (feature 016 T015, FR-012). */
describe("initialsOf", () => {
  it.each([
    ["Ana Mora", null, "AM"],
    ["ana maría mora vargas", null, "AV"],
    ["Ángel", null, "Á"],
    ["  Luis  ", null, "L"],
    ["🌴 Sofía Díaz", null, "SD"],
    [null, "emily@example.com", "E"],
    ["", "marco@example.com", "M"],
    [null, null, "?"],
  ])("%s / %s → %s", (name, email, expected) => {
    expect(initialsOf(name, email)).toBe(expected);
  });
});
