import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_TOPICS, redactRestrictedValues } from "@guidesk/domain";
import {
  AnthropicLlmAdapter,
  FakeLlmAdapter,
  type GuideSectionKindValue,
  type LlmPort,
} from "@guidesk/integrations";
import { CaseError, loadDrafting } from "./cases.js";
import { scoreCase, scoreSuite, type CaseScore } from "./score.js";

/**
 * Guide eval runner (feature 003 research R6, SC-002, constitution V). Every change to a guide
 * prompt, schema, model, or effort must pass it before merge. The drafting suite runs today; the
 * interview and translation suites join it with their user stories (T092, T102).
 *
 * - `pnpm --filter @guidesk/evals-guide eval` calls the real model (`ANTHROPIC_API_KEY`; 33 calls
 *   for drafting) and exits 1 when a target is missed or the key is missing.
 * - `EVAL_LLM=fake` checks the runner with `FakeLlmAdapter`; scores are printed but never fail.
 */
const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const CASES_DIR = path.join(PACKAGE_DIR, "cases");
const REPORT_DIR = path.join(PACKAGE_DIR, "report");
const CALL_TIMEOUT_MS = 60_000;
const TOPICS = GUIDE_TOPICS.map((topic) => ({
  id: topic.id,
  sectionKind: topic.section as GuideSectionKindValue,
}));

async function main(): Promise<number> {
  const mode = process.env.EVAL_LLM ?? "anthropic";
  if (mode !== "anthropic" && mode !== "fake")
    throw new CaseError(`EVAL_LLM must be "anthropic" or "fake"`);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (mode === "anthropic" && !apiKey) {
    console.error("ANTHROPIC_API_KEY is required for the guide evals (or set EVAL_LLM=fake).");
    return 1;
  }
  const llm: LlmPort =
    mode === "fake" ? new FakeLlmAdapter() : new AnthropicLlmAdapter({ apiKey: apiKey! });
  const cases = await loadDrafting(CASES_DIR);
  const scores: CaseScore[] = [];
  for (const testCase of cases) {
    const modelInput = redactRestrictedValues(testCase.description).text;
    try {
      const answer = await llm.draftFromListing(
        { language: testCase.language, description: modelInput, topics: TOPICS },
        { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
      );
      scores.push(scoreCase(testCase, modelInput, answer.result, answer.outcome));
    } catch (error: unknown) {
      scores.push(
        scoreCase(testCase, modelInput, null, error instanceof Error ? error.name : "error"),
      );
    }
  }
  const suite = scoreSuite(scores);
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    path.join(REPORT_DIR, "report.json"),
    JSON.stringify({ drafting: { suite, scores } }, null, 2),
  );
  const lines = [
    "# Guide evals",
    "",
    `Drafting: placement ${(suite.placement * 100).toFixed(1)}% (target ≥ 90%), invented facts ${suite.invented} (target 0), forbidden ${suite.forbidden} (target 0), failed calls ${suite.failedCalls}.`,
    "",
    ...scores
      .filter(
        (score) =>
          score.misplaced.length ||
          score.invented.length ||
          score.forbidden.length ||
          score.outcome !== "ok",
      )
      .map(
        (score) =>
          `- ${score.id}: ${[...score.misplaced, ...score.invented.map((value) => `invented ${value}`), ...score.forbidden.map((value) => `forbidden ${value}`), score.outcome === "ok" ? "" : score.outcome].filter(Boolean).join("; ")}`,
      ),
  ];
  await writeFile(path.join(REPORT_DIR, "summary.md"), `${lines.join("\n")}\n`);
  // eslint-disable-next-line no-console -- the report is the output
  console.log(lines.join("\n"));
  if (mode === "fake") return 0;
  return suite.passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
