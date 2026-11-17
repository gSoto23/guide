import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactRestrictedValues } from "@guidesk/domain";
import {
  AnthropicLlmAdapter,
  EXTRACTION_EFFORT,
  EXTRACTION_MODEL,
  EXTRACTION_SYSTEM_PROMPT,
  FakeLlmAdapter,
  type LlmPort,
} from "@guidesk/integrations";
import { CaseError, loadSuite, type EvalCase } from "./cases.js";
import { scoreSuite, type CaseRun, type SuiteResult } from "./score.js";

/**
 * Extraction eval runner (research R6, SC-002, constitution V). Every change to the extraction
 * prompt, schema, model, or effort must pass it before merge.
 *
 * For each case it redacts the text with the restricted-value detector first, exactly as the
 * pipeline does (research R4), calls the adapter, and scores field placement (at least 90%),
 * invented facts (0), injection resistance (all cases), and restricted values reaching the model
 * or its output (0). It writes `report/report.json` and `report/summary.md`.
 *
 * - `pnpm --filter @guidesk/evals-extraction eval` calls the real model (`ANTHROPIC_API_KEY`;
 *   35 calls, about $1–2) and exits 1 when a target is missed or the key is missing.
 * - `EVAL_LLM=fake` uses `FakeLlmAdapter` to check the runner without the API; scores are
 *   printed but never fail the run.
 */

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const CASES_DIR = path.join(PACKAGE_DIR, "cases");
const REPORT_DIR = path.join(PACKAGE_DIR, "report");
const CONCURRENCY = 5;
/** The whole extraction job has 60 seconds (FR-016). */
const CALL_TIMEOUT_MS = 60_000;

type Mode = "anthropic" | "fake";

function readMode(): Mode {
  const value = process.env.EVAL_LLM ?? "anthropic";
  if (value !== "anthropic" && value !== "fake") {
    throw new CaseError(`EVAL_LLM must be "anthropic" or "fake", not "${value}"`);
  }
  return value;
}

/** Runs `task` over `items` with at most `limit` in flight, keeping the input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function runCase(llm: LlmPort, testCase: EvalCase): Promise<CaseRun> {
  const redaction = redactRestrictedValues(testCase.text);
  const redactions = Object.values(redaction.counts).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0,
  );
  const base = { testCase, modelInput: redaction.text, redactions };
  const started = performance.now();
  try {
    const answer = await llm.extractListing(redaction.text, {
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    return {
      ...base,
      outcome: answer.outcome,
      result: answer.result,
      usage: answer.usage,
      model: answer.model,
      error: null,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error: unknown) {
    // Adapter errors never carry the listing text (LlmTimeoutError, LlmUnavailableError).
    return {
      ...base,
      outcome: "error",
      result: null,
      usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
      model: null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
      durationMs: Math.round(performance.now() - started),
    };
  }
}

interface Report extends SuiteResult {
  mode: Mode;
  /** Fake runs only check the runner; their scores mean nothing. */
  fake: boolean;
  requestedModel: string;
  effort: string;
  /** First 16 hex characters of the SHA-256 of the system prompt, to tie a run to a prompt. */
  promptSha256: string;
  startedAt: string;
  durationMs: number;
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function scoreLines(report: Report): string[] {
  const { fieldPlacement, inventedFacts, injectionResistance, restrictedLeaks } = report.scores;
  const mark = (met: boolean) => (met ? "met" : "MISSED");
  return [
    `Field placement: ${fieldPlacement.correct}/${fieldPlacement.total} (${percent(fieldPlacement.rate)}), target ≥ ${percent(fieldPlacement.target)}: ${mark(fieldPlacement.met)}`,
    `Invented facts: ${inventedFacts.count}, target ${inventedFacts.target}: ${mark(inventedFacts.met)}`,
    `Injection resistance: ${injectionResistance.passed}/${injectionResistance.total}, target ${injectionResistance.total}/${injectionResistance.total}: ${mark(injectionResistance.met)}`,
    `Restricted values reaching the model or output: ${restrictedLeaks.count}, target ${restrictedLeaks.target}: ${mark(restrictedLeaks.met)}`,
  ];
}

function outcomeLine(report: Report): string {
  return Object.entries(report.outcomes)
    .map(([outcome, count]) => `${outcome} ${count}`)
    .join(", ");
}

function renderSummary(report: Report): string {
  const verdict = report.fake ? "FAKE RUN (not gated)" : report.passed ? "PASS" : "FAIL";
  const lines = [
    `# Extraction eval: ${verdict}`,
    "",
    `- Mode: ${report.mode}${report.fake ? " (FakeLlmAdapter; scores do not reflect the model)" : ""}`,
    `- Model: ${report.requestedModel} at effort ${report.effort}; answered by ${report.models.join(", ") || "none"}`,
    `- Prompt SHA-256: ${report.promptSha256}`,
    `- Started: ${report.startedAt}; took ${(report.durationMs / 1000).toFixed(1)} s`,
    `- Outcomes: ${outcomeLine(report)}`,
    `- Tokens: ${report.usage.inputTokens} in, ${report.usage.outputTokens} out; cost ${usd(report.usage.costUsdMicros)}`,
    "",
    "## Scores",
    "",
    ...scoreLines(report).map((line) => `- ${line}`),
    "",
    "## Cases",
    "",
    "| Case | Kind | Outcome | Redactions | Result |",
    "| --- | --- | --- | --- | --- |",
    ...report.cases.map(
      (item) =>
        `| ${item.id} | ${item.kind} | ${item.outcome} | ${item.redactions} | ${item.passed ? "pass" : "fail"} |`,
    ),
  ];
  const noted = report.cases.filter((item) => !item.passed || item.warnings.length > 0);
  if (noted.length > 0) {
    lines.push("", "## Failures and warnings", "");
    for (const item of noted) {
      lines.push(`### ${item.id}`, "");
      for (const failure of item.failures) lines.push(`- ${failure}`);
      for (const warning of item.warnings) lines.push(`- warning: ${warning}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<number> {
  const mode = readMode();
  const suite = await loadSuite(CASES_DIR);
  const cases: EvalCase[] = [...suite.listings, ...suite.injections];

  let llm: LlmPort;
  if (mode === "fake") {
    llm = new FakeLlmAdapter();
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      console.error(
        "ANTHROPIC_API_KEY is not set. Set it to run the eval against the model, or use EVAL_LLM=fake to check the runner without it.",
      );
      return 1;
    }
    llm = new AnthropicLlmAdapter({ apiKey });
  }

  console.warn(
    `Extraction eval: ${cases.length} cases (${suite.listings.length} listings, ${suite.injections.length} injection) with ${mode === "fake" ? "the fake model" : `${EXTRACTION_MODEL} at effort ${EXTRACTION_EFFORT}`}…`,
  );
  const startedAt = new Date();
  const runs = await mapWithConcurrency(cases, CONCURRENCY, (testCase) => runCase(llm, testCase));
  const report: Report = {
    mode,
    fake: mode === "fake",
    requestedModel: EXTRACTION_MODEL,
    effort: EXTRACTION_EFFORT,
    promptSha256: createHash("sha256").update(EXTRACTION_SYSTEM_PROMPT).digest("hex").slice(0, 16),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ...scoreSuite(runs),
  };

  await mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "report.json");
  const summaryPath = path.join(REPORT_DIR, "summary.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(summaryPath, renderSummary(report));

  const failed = report.cases.filter((testCase) => !testCase.passed).map((testCase) => testCase.id);
  console.warn(
    [
      ...scoreLines(report),
      `Outcomes: ${outcomeLine(report)}`,
      `Tokens: ${report.usage.inputTokens} in, ${report.usage.outputTokens} out; cost ${usd(report.usage.costUsdMicros)}`,
      `Failing cases (${failed.length}): ${failed.join(", ") || "none"}`,
      `Report: ${path.relative(process.cwd(), jsonPath)}, ${path.relative(process.cwd(), summaryPath)}`,
      report.fake
        ? "FAKE RUN: the fake model only checks the runner; scores are not gated."
        : report.passed
          ? "PASS"
          : "FAIL",
    ].join("\n"),
  );
  if (report.fake) return 0;
  return report.passed ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof CaseError ? error.message : error);
    process.exitCode = 1;
  },
);
