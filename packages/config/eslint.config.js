// Shared ESLint flat config for Guidesk packages and apps.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Only the worker and the locked-field reveal service decrypt restricted values (feature 002
// research R5, feature 003 research R4, SEC-06): the rest of the API encrypts with
// `@guidesk/vault` but never reads plaintext back. `files` globs are relative to the config that
// loads this one (the repository root for apps/api, apps/worker, and packages/*).
const VAULT_DECRYPT_MESSAGE =
  "Only apps/worker/src, apps/api/src/locked-fields/reveal.service.ts, and apps/api/src/guest/stay-link-secrets.ts may import @guidesk/vault/decrypt (research R5, feature 003 R4, feature 004 R4, SEC-06). The rest of the API encrypts and never decrypts restricted values.";
const VAULT_DECRYPT_ALLOWED = [
  "apps/worker/src/**",
  "apps/worker/test/**",
  "packages/vault/**",
  // Feature 003 (research R4): the single API file that reveals a locked field.
  "apps/api/src/locked-fields/reveal.service.ts",
  // Feature 004 (research R4): stay tokens and confirmation codes, never locked-field values.
  "apps/api/src/guest/stay-link-secrets.ts",
];

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
    // Feature 004 (research R12): guest routes read tenant data in the system context, so only
    // the guest context and the stay link secrets may take the system database handle.
    files: ["apps/api/src/guest/**/*.ts"],
    ignores: ["apps/api/src/guest/guest-context.ts", "apps/api/src/guest/stay-link-secrets.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@guidesk/vault/decrypt", message: VAULT_DECRYPT_MESSAGE },
            {
              name: "../database/database.module.js",
              importNames: ["DB_HANDLE"],
              message:
                "Guest code reads through GuestContext (feature 004 research R12): resolve the workspace and property from a link or session first.",
            },
          ],
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
