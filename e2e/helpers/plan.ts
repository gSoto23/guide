import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Feature 011 helpers: the founder tool sets a workspace's plan, as the founder would, with the
 * local `.env` database. End-to-end tests run against the local stack only.
 */
function repoRoot(): string {
  for (const candidate of [resolve(process.cwd(), ".."), process.cwd()]) {
    if (existsSync(resolve(candidate, "packages/db/dist/cli/plan.js"))) return candidate;
  }
  throw new Error("Build @guidesk/db first: packages/db/dist/cli/plan.js is missing");
}

export async function workspaceIdOf(page: Page): Promise<string> {
  const me = (await (await page.request.get("/api/v1/me")).json()) as { lastWorkspaceId: string };
  return me.lastWorkspaceId;
}

/** Runs `plan:set` and returns its report (plans, limits, and counts only); throws on failure. */
export function setPlan(
  workspaceId: string,
  plan: "free" | "pro" | "business",
  options: { aiReplies?: number | "plan"; seats?: number | "plan"; note?: string } = {},
): string {
  const root = repoRoot();
  const result = spawnSync(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      "packages/db/dist/cli/plan.js",
      "set",
      "--workspace",
      workspaceId,
      "--plan",
      plan,
      ...(options.aiReplies !== undefined ? ["--ai-replies", String(options.aiReplies)] : []),
      ...(options.seats !== undefined ? ["--seats", String(options.seats)] : []),
      "--note",
      options.note ?? "e2e",
    ],
    { cwd: root, encoding: "utf8" },
  );
  // The tool prints its report on stderr, like the pilot report.
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) throw new Error(`plan:set failed: ${output}`);
  return output;
}

/**
 * Free has one seat (the owner). Team tests give the signed-in workspace 10 seats as a custom limit,
 * like the pilot default before feature 011, so Free's other limits still apply.
 */
export async function roomForTeam(page: Page): Promise<void> {
  setPlan(await workspaceIdOf(page), "free", { seats: 10, note: "e2e team" });
}
