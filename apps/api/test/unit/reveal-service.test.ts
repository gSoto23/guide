import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKeyManagement } from "@guidesk/integrations";
import { RevealService } from "../../src/locked-fields/reveal.service.js";

/**
 * The reveal service (feature 003 T062, research R4): a value that fails to decrypt (tampered, or
 * copied from another row) raises an error that carries no value, and a missing field is null.
 */
function handleReturning(row: object | undefined) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => (row ? [row] : []),
  };
  return { db: chain } as never;
}

const kms = createKeyManagement({ mode: "local", localKey: Buffer.alloc(32, 3) });

describe("RevealService", () => {
  it("returns null for a field that does not exist or has no value", async () => {
    expect(
      await new RevealService(handleReturning(undefined), kms).valueOf(
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ),
    ).toBeNull();
    const empty = { id: randomUUID(), ciphertext: null, dataKeyId: null, publicValue: null };
    expect(
      await new RevealService(handleReturning(empty), kms).valueOf(
        randomUUID(),
        randomUUID(),
        empty.id,
      ),
    ).toBeNull();
  });

  it("returns a public Wi-Fi password without decrypting", async () => {
    const row = { id: randomUUID(), ciphertext: null, dataKeyId: null, publicValue: "Colibri2026" };
    expect(
      await new RevealService(handleReturning(row), kms).valueOf(
        randomUUID(),
        randomUUID(),
        row.id,
      ),
    ).toBe("Colibri2026");
  });

  it("fails without the value when the ciphertext cannot be decrypted", async () => {
    const row = {
      id: randomUUID(),
      ciphertext: Buffer.from("4821-not-really-ciphertext"),
      dataKeyId: randomUUID(),
      publicValue: null,
    };
    const error = await new RevealService(handleReturning(row), kms)
      .valueOf(randomUUID(), randomUUID(), row.id)
      .catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("4821");
  });
});
