"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { CreatedCsvImport, CsvIssueBody, ImportRun } from "@guidesk/contracts";
import type { WorkspaceApi } from "./properties-api";

/** Files up to 2 MB (FR-038); larger ones are refused before uploading. */
export const CSV_MAX_BYTES = 2 * 1024 * 1024;

/** Declared types the API accepts; a phone may report none, or one of its own. */
const CSV_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain"];

export function csvContentType(file: File): string {
  return CSV_TYPES.includes(file.type) ? file.type : "text/csv";
}

/** The template's language: the portal's, Spanish unless it is English. */
export function csvLanguage(locale: string): "es" | "en" {
  return locale.startsWith("en") ? "en" : "es";
}

/** Posts the file to its presigned form, the fields first and the file last (research R9). */
export async function uploadCsv(
  form: CreatedCsvImport["upload"],
  file: File,
  contentType: string,
): Promise<boolean> {
  const body = new FormData();
  for (const [name, value] of Object.entries(form.fields)) body.append(name, value);
  body.append("file", new Blob([file], { type: contentType }), "import.csv");
  try {
    const response = await fetch(form.url, { method: "POST", body });
    return response.ok;
  } catch {
    return false;
  }
}

const POLL_MS = 1000;
const POLL_LIMIT_MS = 60_000;

/** Waits for the worker to validate the file; null when it takes more than a minute. */
export async function waitForValidation(
  api: WorkspaceApi,
  importRunId: string,
): Promise<ImportRun | null> {
  const started = Date.now();
  while (Date.now() - started < POLL_LIMIT_MS) {
    const run = await api.get<ImportRun>(`/imports/${encodeURIComponent(importRunId)}`);
    if (run.status !== "validating") return run;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}

/** "Column: reason" for a row's error or warning, in the portal's language (FR-039). */
export function useCsvIssueText(): (issue: CsvIssueBody) => string {
  const t = useTranslations("properties.csv");
  return useCallback(
    (issue: CsvIssueBody) => {
      const reasonKey = t.has(`reasons.${issue.code}`) ? issue.code : "other";
      const reason = t(`reasons.${reasonKey}`, { row: issue.row ?? "" });
      const column =
        issue.column && t.has(`columns.${issue.column}`) ? t(`columns.${issue.column}`) : null;
      return column ? `${column}: ${reason}` : reason;
    },
    [t],
  );
}
