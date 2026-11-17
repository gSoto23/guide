// Shared ESLint flat config for Guidesk packages and apps.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Only the worker decrypts restricted values (research R5, SEC-06): the API encrypts with
// `@guidesk/vault` but never reads plaintext back. `files` globs are relative to the config that
// loads this one (the repository root for apps/api, apps/worker, and packages/*).
const VAULT_DECRYPT_MESSAGE =
  "Only apps/worker/src may import @guidesk/vault/decrypt (research R5, SEC-06). The API encrypts and never decrypts restricted values.";
const VAULT_DECRYPT_ALLOWED = ["apps/worker/src/**", "apps/worker/test/**", "packages/vault/**"];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/.sst/**", "**/.turbo/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@guidesk/vault/decrypt", message: VAULT_DECRYPT_MESSAGE }],
          patterns: [
            {
              // Subpaths of the entry point and relative paths into the vault's sources or build.
              regex:
                "^@guidesk/vault/(decrypt/|dist/)|(^|/)vault/(src|dist)/decrypt(\\.[cm]?[jt]s)?$",
              message: VAULT_DECRYPT_MESSAGE,
            },
          ],
        },
      ],
      // `no-restricted-imports` does not see dynamic `import()`.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value='@guidesk/vault/decrypt']",
          message: VAULT_DECRYPT_MESSAGE,
        },
      ],
    },
  },
  {
    files: VAULT_DECRYPT_ALLOWED,
    rules: {
      // These two rules hold only the vault restriction above; if either gains another entry,
      // repeat it here without the vault one instead of turning the rule off.
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
);
