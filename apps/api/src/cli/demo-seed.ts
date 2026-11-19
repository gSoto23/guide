/**
 * The founder's demo command (feature 014 US3, contracts/demo-seed-cli.md):
 *
 *   node dist/cli/demo-seed.js --email <account email> [--json]
 *
 * Builds a demo workspace on a non-production stage, with the API's configuration and its KMS
 * permission (research R9, R10). Prints no code, no stay link, and no data values.
 */
import { createDb } from "@guidesk/db";
import { createKeyManagement } from "@guidesk/integrations";
import { Vault } from "@guidesk/vault";
import { loadApiConfig } from "../config/config.js";
import { assertDemoAllowed, DemoSeedError, seedDemo, type DemoSeedResult } from "../demo/seed.js";

const EXIT = {
  usage: 2,
  production_refused: 3,
  unknown_account: 4,
  unverified_account: 4,
} as const;

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export function formatResult(result: DemoSeedResult, email: string): string {
  return [
    `Demo workspace created: ${result.workspaceName} (${result.workspaceId})`,
    `Owner: ${email}`,
    ...result.properties.map((entry) => `${entry.name} guide: ${entry.guideUrl}`),
    "Current stay link: open the portal → Casa Brisa → Stays → current stay → Copy link.",
  ].join("\n");
}

export async function main(args: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const email = option(args, "email");
  if (!email || email.startsWith("--")) {
    console.error("usage: demo-seed --email <account email> [--json]");
    return EXIT.usage;
  }
  try {
    assertDemoAllowed({ NODE_ENV: env.NODE_ENV, STAGE: env.STAGE });
  } catch (error) {
    if (error instanceof DemoSeedError) {
      console.error(`${error.code}: ${error.message}`);
      return EXIT[error.code];
    }
    throw error;
  }

  const config = loadApiConfig(env);
  const handle = createDb(config.DATABASE_URL, { max: 1 });
  try {
    const vault = new Vault(createKeyManagement(config.integrations.kms));
    const result = await seedDemo({ db: handle.db, vault }, { email, guideUrl: config.GUIDE_URL });
    console.warn(
      args.includes("--json")
        ? JSON.stringify({
            workspaceId: result.workspaceId,
            workspaceName: result.workspaceName,
            properties: result.properties,
          })
        : formatResult(result, email.trim()),
    );
    return 0;
  } catch (error) {
    if (error instanceof DemoSeedError) {
      console.error(`${error.code}: ${error.message}`);
      return EXIT[error.code];
    }
    // Never print the error's data: only its kind (constitution VI).
    console.error(`seed_failed: ${error instanceof Error ? error.name : "unknown"}`);
    return 1;
  } finally {
    await handle.pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
