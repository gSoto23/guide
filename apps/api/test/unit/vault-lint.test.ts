import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The vault decryption rule (feature 002 research R5, feature 003 research R4, SEC-06): only the
 * worker and the locked-field reveal service may import `@guidesk/vault/decrypt`.
 */
const root = resolve(import.meta.dirname, "../../../..");
const source =
  'import { VaultDecrypter } from "@guidesk/vault/decrypt";\nexport { VaultDecrypter };\n';

async function ruleIds(filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, { filePath: resolve(root, filePath) });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "");
}

describe("vault decryption imports", () => {
  it("allows the reveal service", async () => {
    expect(await ruleIds("apps/api/src/locked-fields/reveal.service.ts")).not.toContain(
      "no-restricted-imports",
    );
  });

  it("refuses any other API file, including the rest of the locked-fields module", async () => {
    expect(await ruleIds("apps/api/src/locked-fields/locked-fields.service.ts")).toContain(
      "no-restricted-imports",
    );
    expect(await ruleIds("apps/api/src/guides/guides.service.ts")).toContain(
      "no-restricted-imports",
    );
  });
});
