"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  CreatedCsvImport,
  ImportItem,
  ImportItemList,
  ImportRun,
  PropertyLimits,
} from "@guidesk/contracts";
import {
  CSV_MAX_BYTES,
  csvContentType,
  csvLanguage,
  uploadCsv,
  waitForValidation,
} from "@/lib/csv";
import { problemOf, workspacePath } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

/** The review is loaded once a file is checked, so the first screen stays light. */
const CsvReview = dynamic(() => import("./csv-review").then((module) => module.CsvReview), {
  ssr: false,
});

const FILE_ERRORS = new Set([
  "too_large",
  "too_many_rows",
  "unsupported_type",
  "unreadable",
  "not_found",
  "missing_name_column",
  "duplicate_column",
  "no_rows",
]);

type Message = { kind: "info" | "error"; text: string };

/**
 * "Import a CSV file" (US5, T111): download the template in the portal's language, pick the file
 * (from a phone too), and send it for checking. The review comes next, with errors by row and
 * column and the choice of rows within the plan's limit.
 */
export function CsvImportFlow({ locale }: { locale: string }) {
  const t = useTranslations("properties.csv");
  const properties = useTranslations("properties");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [review, setReview] = useState<{
    run: ImportRun;
    items: ImportItem[];
    limits: PropertyLimits;
  } | null>(null);

  if (!workspace) return <p className="muted">{properties("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{properties("start.notAllowed")}</p>;
  const api = workspace.api;
  const language = csvLanguage(locale);
  const templateUrl = workspacePath(
    workspace.workspaceId,
    `/imports/csv-template?lang=${language}`,
  );

  const fileError = (code: string | null | undefined): Message => ({
    kind: "error",
    text: t(`fileErrors.${code && FILE_ERRORS.has(code) ? code : "internal"}`),
  });

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) {
      setMessage(fileError("too_large"));
      return;
    }
    setChecking(true);
    setMessage(null);
    try {
      const contentType = csvContentType(file);
      const created = await api.post<CreatedCsvImport>(
        "/imports/csv",
        { contentType, size: Math.max(file.size, 1) },
        { idempotent: true },
      );
      if (!(await uploadCsv(created.upload, file, contentType))) {
        setMessage(fileError("not_found"));
        return;
      }
      await api.post(`/imports/${created.importRunId}/validate`);
      const run = await waitForValidation(api, created.importRunId);
      if (!run) {
        setMessage({ kind: "error", text: t("fileErrors.timeout") });
        return;
      }
      if (run.status === "failed") {
        setMessage(fileError(run.errorCode));
        return;
      }
      const [list, limits] = await Promise.all([
        api.get<ImportItemList>(`/imports/${created.importRunId}/items`),
        api.get<PropertyLimits>("/properties/limits"),
      ]);
      setReview({ run, items: list.items, limits });
    } catch (error) {
      const code = problemOf(error)?.code;
      setMessage(
        code === "validation_failed"
          ? fileError("unsupported_type")
          : {
              kind: "error",
              text: errors(
                code === "network" || code === "workspace_pending_deletion"
                  ? code
                  : "internal_error",
              ),
            },
      );
    } finally {
      setChecking(false);
    }
  }

  if (review) {
    return (
      <CsvReview
        locale={locale}
        api={api}
        errorFileUrl={workspacePath(
          workspace.workspaceId,
          `/imports/${review.run.id}/error-file?lang=${language}`,
        )}
        run={review.run}
        items={review.items}
        limits={review.limits}
        onCancelled={() => {
          setReview(null);
          setFile(null);
          setMessage({ kind: "info", text: t("review.cancelled") });
        }}
      />
    );
  }

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      <p>
        <a className="button button-secondary" href={templateUrl} download>
          {t("template")}
        </a>
      </p>
      <p className="muted">{t("templateHint")}</p>
      <p className="alert alert-info">{t("noCodes")}</p>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role="alert"
        >
          {message.text}
        </p>
      ) : null}
      <form className="form" onSubmit={check} noValidate>
        <fieldset className="field">
          <legend>{t("file")}</legend>
          <p className="muted" id="csv-file-hint">
            {t("fileHint")}
          </p>
          <label className="button button-secondary file-button">
            {t("chooseFile")}
            <input
              type="file"
              className="visually-hidden"
              accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
              aria-describedby="csv-file-hint"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setMessage(null);
              }}
            />
          </label>
          {file ? <p>{t("chosen", { name: file.name })}</p> : null}
        </fieldset>
        <button
          type="submit"
          className="button button-primary"
          disabled={!file || checking || !online}
        >
          {checking ? t("checking") : t("check")}
        </button>
      </form>
    </>
  );
}
