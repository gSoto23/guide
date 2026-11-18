import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_TOPICS, redactRestrictedValues } from "@guidesk/domain";
import {
  AnthropicLlmAdapter,
  FakeLlmAdapter,
  type GuideSectionKindValue,
  type LlmPort,
} from "@guidesk/integrations";
import { CaseError, loadDrafting, loadInterview, loadTranslation } from "./cases.js";
import {
  scoreCase,
  scoreInterviewCase,
  scoreInterviewSuite,
  scoreSuite,
  scoreTranslationCase,
  scoreTranslationSuite,
  type CaseScore,
  type InterviewCaseScore,
  type TranslationCaseScore,
} from "./score.js";

/**
 * Guide eval runner (feature 003 research R6, SC-002, SC-003, constitution V). Every change to a
 * guide prompt, schema, model, or effort must pass it before merge.
 *
 * - `pnpm --filter @guidesk/evals-guide eval` calls the real model (`ANTHROPIC_API_KEY`; 33 calls
 *   for drafting, 43 for the interview, and 30 for translation) and exits 1 when a target is
 *   missed or the key is missing. `EVAL_SUITE=drafting`, `interview`, or `translation` runs one
 *   suite.
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

const require = createRequire(import.meta.url);
type Catalog = { guide: { topics: Record<string, { question?: string }> } };
const CATALOGS: Record<"es" | "en", Catalog> = {
  es: require("@guidesk/i18n/messages/es.json") as Catalog,
  en: require("@guidesk/i18n/messages/en.json") as Catalog,
};

async function runDrafting(
  llm: LlmPort,
): Promise<{ lines: string[]; passed: boolean; report: object }> {
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
  const lines = [
    `Drafting: placement ${(suite.placement * 100).toFixed(1)}% (target ≥ 90%), invented facts ${suite.invented} (target 0), forbidden ${suite.forbidden} (target 0), failed calls ${suite.failedCalls}.`,
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
  return { lines, passed: suite.passed, report: { suite, scores } };
}

async function runInterview(
  llm: LlmPort,
): Promise<{ lines: string[]; passed: boolean; report: object }> {
  const cases = await loadInterview(CASES_DIR);
  const scores: InterviewCaseScore[] = [];
  for (const testCase of cases) {
    const topic = GUIDE_TOPICS.find((entry) => entry.id === testCase.topicId);
    if (!topic) throw new CaseError(`${testCase.file}: unknown topic`);
    const question =
      CATALOGS[testCase.language].guide.topics[testCase.topicId]?.question ?? testCase.topicId;
    // The worker sends the answer only after the detector (AC-SEC-004).
    const answer = redactRestrictedValues(testCase.answer).text;
    const modelInput = `${question}\n${answer}`;
    try {
      const result = await llm.draftAnswer(
        {
          language: testCase.language,
          topicId: testCase.topicId,
          sectionKind: topic.section as GuideSectionKindValue,
          question,
          answer,
          topics: TOPICS,
        },
        { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
      );
      scores.push(scoreInterviewCase(testCase, modelInput, result.result, result.outcome));
    } catch (error: unknown) {
      scores.push(
        scoreInterviewCase(
          testCase,
          modelInput,
          null,
          error instanceof Error ? error.name : "error",
        ),
      );
    }
  }
  const suite = scoreInterviewSuite(scores);
  const lines = [
    `Interview: placement ${(suite.placement * 100).toFixed(1)}% (target ≥ 90%), invented facts ${suite.invented} (target 0), codes in output ${suite.codes} (target 0), forbidden ${suite.forbidden} (target 0), failed calls ${suite.failedCalls}.`,
    ...scores
      .filter(
        (score) =>
          !score.placed ||
          score.invented.length ||
          score.codes ||
          score.forbidden.length ||
          score.outcome !== "ok",
      )
      .map(
        (score) =>
          `- ${score.id} (${score.kind}): ${[score.placed ? "" : "misplaced", ...score.invented.map((value) => `invented ${value}`), score.codes ? `${score.codes} code(s)` : "", ...score.forbidden.map((value) => `forbidden ${value}`), score.outcome === "ok" ? "" : score.outcome].filter(Boolean).join("; ")}`,
      ),
  ];
  return { lines, passed: suite.passed, report: { suite, scores } };
}

async function runTranslation(
  llm: LlmPort,
): Promise<{ lines: string[]; passed: boolean; report: object }> {
  const cases = await loadTranslation(CASES_DIR);
  const scores: TranslationCaseScore[] = [];
  for (const testCase of cases) {
    try {
      const result = await llm.translateBlocks(
        { from: testCase.from, to: testCase.to, blocks: testCase.blocks },
        { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
      );
      scores.push(scoreTranslationCase(testCase, result.result, result.outcome));
    } catch (error: unknown) {
      scores.push(
        scoreTranslationCase(testCase, null, error instanceof Error ? error.name : "error"),
      );
    }
  }
  const suite = scoreTranslationSuite(scores);
  const lines = [
    `Translation: tokens kept ${(suite.tokens * 100).toFixed(1)}% (target 100%), content issues ${suite.contentIssues} (target 0), failed calls ${suite.failedCalls}.`,
    ...scores
      .filter(
        (score) =>
          score.tokensKept < score.blocks || score.content.length || score.outcome !== "ok",
      )
      .map(
        (score) =>
          `- ${score.id}: ${[score.tokensKept < score.blocks ? `tokens ${score.tokensKept}/${score.blocks}` : "", ...score.content, score.outcome === "ok" ? "" : score.outcome].filter(Boolean).join("; ")}`,
      ),
  ];
  return { lines, passed: suite.passed, report: { suite, scores } };
}

async function main(): Promise<number> {
  const mode = process.env.EVAL_LLM ?? "anthropic";
  if (mode !== "anthropic" && mode !== "fake")
    throw new CaseError(`EVAL_LLM must be "anthropic" or "fake"`);
  const which = process.env.EVAL_SUITE ?? "all";
  if (!["all", "drafting", "interview", "translation"].includes(which))
    throw new CaseError(`EVAL_SUITE must be "all", "drafting", "interview", or "translation"`);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (mode === "anthropic" && !apiKey) {
    console.error("ANTHROPIC_API_KEY is required for the guide evals (or set EVAL_LLM=fake).");
    return 1;
  }
  const llm: LlmPort =
    mode === "fake" ? new FakeLlmAdapter() : new AnthropicLlmAdapter({ apiKey: apiKey! });
  const results: Record<string, { lines: string[]; passed: boolean; report: object }> = {};
  if (which === "all" || which === "drafting") results.drafting = await runDrafting(llm);
  if (which === "all" || which === "interview") results.interview = await runInterview(llm);
  if (which === "all" || which === "translation") results.translation = await runTranslation(llm);

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    path.join(REPORT_DIR, "report.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(results).map(([name, value]) => [name, value.report])),
      null,
      2,
    ),
  );
  const lines = [
    "# Guide evals",
    "",
    ...Object.values(results).flatMap((result) => [...result.lines, ""]),
  ];
  await writeFile(path.join(REPORT_DIR, "summary.md"), `${lines.join("\n")}\n`);
  // eslint-disable-next-line no-console -- the report is the output
  console.log(lines.join("\n"));
  if (mode === "fake") return 0;
  return Object.values(results).every((result) => result.passed) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
