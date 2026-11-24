"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PropertyDetail } from "@guidesk/contracts";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";
import { PlanLink } from "../plan/plan-link";
import { CoreFactsForm, type CoreFactsBody } from "./core-facts-form";

const KNOWN_ERRORS = new Set([
  "plan_limit_reached",
  "workspace_pending_deletion",
  "mfa_enrollment_required",
  "step_up_required",
  "forbidden",
  "network",
]);

/**
 * A blank property (US1): the confirmation step, then the new property's page. The page renders the
 * heading on the server (first paint), so this renders only what needs the workspace.
 */
export function BlankProperty({ locale }: { locale: string }) {
  const t = useTranslations("properties");
  const errors = useTranslations("errors");
  const router = useRouter();
  const workspace = useWorkspace();
  const { run, dialog } = useStepUp();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [message, setMessage] = useState<string | null>(null);
  // The message is the plan's property limit: owners and admins get a link to the plan (feature 011).
  const [atLimit, setAtLimit] = useState(false);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("start.notAllowed")}</p>;

  async function create(body: CoreFactsBody): Promise<boolean> {
    setMessage(null);
    setAtLimit(false);
    setFieldErrors(undefined);
    try {
      // A second factor is asked for once the workspace has 3 properties (FR-048).
      const created = await run(() =>
        workspace!.api.post<PropertyDetail>(
          "/properties",
          { ...body, source: "manual" },
          { idempotent: true },
        ),
      );
      if (!created) return false;
      router.push(`/${locale}/properties/${created.id}`);
      return true;
    } catch (error) {
      const problem = problemOf(error);
      if (problem?.code === "validation_failed") setFieldErrors(problem.fields);
      else if (problem?.code === "plan_limit_reached") {
        setMessage(t("limits.reached", { limit: problemNumber(problem, "limit") ?? 2 }));
        setAtLimit(true);
      } else {
        setMessage(
          errors(problem && KNOWN_ERRORS.has(problem.code) ? problem.code : "internal_error"),
        );
      }
      return false;
    }
  }

  return (
    <>
      {message ? (
        <p className="alert alert-error" role="alert">
          {message} {atLimit ? <PlanLink locale={locale} /> : null}
        </p>
      ) : null}
      <CoreFactsForm
        api={workspace.api}
        locale={locale}
        draftKey={`blank-property:${workspace.workspaceId}`}
        fieldErrors={fieldErrors}
        onSubmit={create}
      />
      {dialog}
    </>
  );
}
