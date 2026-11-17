import shared from "@guidesk/config/eslint";

const NO_DATABASE =
  "The sandbox handles untrusted content and never reaches the database (research R2).";

export default [
  ...shared,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@guidesk/db", message: NO_DATABASE },
            { name: "pg", message: NO_DATABASE },
            { name: "pg-boss", message: NO_DATABASE },
            { name: "@guidesk/vault", message: "The sandbox never handles keys (research R5)." },
            {
              name: "@guidesk/integrations",
              message:
                "Import @guidesk/integrations/sandbox-protocol only: the main entry carries provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@guidesk/vault/*"],
              message: "The sandbox never handles keys (research R5).",
            },
            { group: ["pg/*", "pg-boss/*", "@guidesk/db/*"], message: NO_DATABASE },
          ],
        },
      ],
    },
  },
];
