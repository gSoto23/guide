"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DuplicateDraft, PropertyDetail, PropertyList } from "@guidesk/contracts";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";
import { PlanLink } from "../plan/plan-link";
import { CoreFactsForm, type CoreFactsBody } from "./core-facts-form";

const KNOWN_ERRORS = new Set([
  "workspace_pending_deletion",
  "mfa_enrollment_required",
  "step_up_required",
  "forbidden",
  "network",
]);

/**
 * "Copy a property" (US6, FR-043, T119): pick the property, then the confirmation step opens
 * with its facts, "Copy of …", and an empty address. The listing content is copied by the API;
 * the address, calendars, stays, codes, and PMS link never are.
 */
export function DuplicateProperty({ locale, from }: { locale: string; from: string | null }) {
  const t = useTranslations("properties");
  const copy = useTranslations("properties.duplicate");
  const errors = useTranslations("errors");
  const router = useRouter();
  const workspace = useWorkspace();
  const { run, dialog } = useStepUp();
  const [draft, setDraft] = useState<DuplicateDraft | null>(null);
  const [choices, setChoices] = useState<PropertyList["items"] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The message is the plan's property limit: owners and admins get a link to the plan (feature 011).
  const [atLimit, setAtLimit] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();

  useEffect(() => {
    if (!workspace?.canManage) return;
    const controller = new AbortController();
    setDraft(null);
    setMessage(null);
    setAtLimit(false);
    const request = from
      ? workspace.api
          .get<DuplicateDraft>(
            `/properties/${encodeURIComponent(from)}/duplicate-draft?lang=${locale === "en" ? "en" : "es"}`,
            controller.signal,
          )
          .then(setDraft)
      : workspace.api
          .get<PropertyList>("/properties?limit=100", controller.signal)
          .then((list) => setChoices(list.items));
    request.catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setMessage(errors(problemOf(error)?.code === "not_found" ? "not_found" : "internal_error"));
    });
    return () => controller.abort();
  }, [workspace, from, locale, errors]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("start.notAllowed")}</p>;

  const alert = message ? (
    <p className="alert alert-error" role="alert">
      {message} {atLimit ? <PlanLink locale={locale} /> : null}
    </p>
  ) : null;

  if (!from) {
    return (
      <>
        <h1>{copy("title")}</h1>
        <p className="muted">{copy("pickIntro")}</p>
        {alert}
        {!choices && !message ? <p className="muted">{t("loading")}</p> : null}
        {choices && choices.length === 0 ? <p className="muted">{copy("pickEmpty")}</p> : null}
        <ul className="property-list">
          {(choices ?? []).map((item) => (
            <li key={item.id}>
              <Link
                className="property-row"
                href={`/${locale}/properties/new/duplicate?from=${encodeURIComponent(item.id)}`}
              >
                <strong>{item.name}</strong>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  async function create(body: CoreFactsBody): Promise<boolean> {
    if (!draft) return false;
    setMessage(null);
    setAtLimit(false);
    setFieldErrors(undefined);
    try {
      // A second factor is asked for once the workspace has 3 properties (FR-048).
      const created = await run(() =>
        workspace!.api.post<PropertyDetail>(
          "/properties",
          { ...body, source: "duplicate", duplicateOf: draft.duplicateOf },
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

  const kinds = draft?.content.map((item) => t(`listing.kinds.${item.kind}`)).join(", ") ?? "";

  return (
    <>
      <h1>{t("facts.title")}</h1>
      {draft ? <p className="muted">{copy("from", { name: draft.sourceName })}</p> : null}
      <p className="alert alert-info">{copy("excluded")}</p>
      {draft ? (
        <p className="muted">{kinds ? copy("content", { kinds }) : copy("noContent")}</p>
      ) : null}
      {alert}
      {draft ? (
        <CoreFactsForm
          api={workspace.api}
          locale={locale}
          draftKey={`duplicate-property:${draft.duplicateOf}`}
          initial={{
            name: draft.name,
            country: draft.country ?? "",
            timeZone: draft.timeZone ?? "",
            checkInTime: draft.checkInTime ?? "",
            checkoutTime: draft.checkoutTime ?? "",
            maxGuests: draft.maxGuests ? String(draft.maxGuests) : "",
            guideLanguages: draft.guideLanguages,
          }}
          submitLabel={copy("create")}
          fieldErrors={fieldErrors}
          onSubmit={create}
        />
      ) : !message ? (
        <p className="muted">{t("loading")}</p>
      ) : null}
      <p>
        <Link href={`/${locale}/properties/new/duplicate`}>{copy("other")}</Link>
      </p>
      {dialog}
    </>
  );
}
