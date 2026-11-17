"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  CreatedExtraction,
  Extraction,
  PropertyDetail,
  StartOptions,
} from "@guidesk/contracts";
import {
  formatResetTime,
  isEmpty,
  toContentItem,
  toReviewItem,
  toTimeValue,
  uploadScreenshot,
  type ReviewItem,
} from "@/lib/extractions";
import { problemNumber, problemOf, problemString } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";
import { CoreFactsForm, type CoreFactsBody, type CoreFactsValue } from "./core-facts-form";
import { ExtractionReview } from "./extraction-review";
import { ListingInput, type PickedScreenshot } from "./listing-input";

const KNOWN_ERRORS = new Set([
  "workspace_pending_deletion",
  "mfa_enrollment_required",
  "step_up_required",
  "forbidden",
  "network",
]);

type Stage = "input" | "review" | "confirm";

/**
 * "Paste your listing" (US2, T062): paste text or add screenshots, review what the AI found, and
 * confirm the core facts, prefilled with the facts it proposed. Nothing is saved as confirmed
 * before the last step, and nothing is published (FR-018).
 *
 * The pasted text stays in memory only, never in browser storage: it may hold a code the host
 * typed despite the warning, and only the server's redacted copy should outlive the page.
 */
export function ListingFlow({ locale }: { locale: string }) {
  const t = useTranslations("properties");
  const listing = useTranslations("properties.listing");
  const errors = useTranslations("errors");
  const router = useRouter();
  const workspace = useWorkspace();
  const online = useOnline();
  const { run, dialog } = useStepUp();
  const [screenshotsEnabled, setScreenshotsEnabled] = useState(false);
  const [stage, setStage] = useState<Stage>("input");
  const [text, setText] = useState("");
  const [screenshots, setScreenshots] = useState<PickedScreenshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [redactions, setRedactions] = useState<Record<string, number>>({});
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [itemProblem, setItemProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace?.canManage) return;
    const controller = new AbortController();
    workspace.api
      .get<StartOptions>("/properties/start-options", controller.signal)
      .then((options) => setScreenshotsEnabled(options.screenshotsEnabled))
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspace]);

  // The first finished result of a request fills the review, once: going back to the review
  // keeps the host's edits.
  const [itemsFor, setItemsFor] = useState<string | null>(null);
  if (extraction?.status === "succeeded" && extraction.result && itemsFor !== extraction.id) {
    setItemsFor(extraction.id);
    setItems(extraction.result.items.map(toReviewItem));
  }

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("start.notAllowed")}</p>;
  const api = workspace.api;

  function limitMessage(problem: ReturnType<typeof problemOf>): string {
    return listing("limitReached", {
      limit: problemNumber(problem, "limit") ?? 10,
      time: formatResetTime(problemString(problem, "resetsAt"), locale),
    });
  }

  async function send() {
    setBusy(true);
    setMessage(null);
    const ready = screenshots.filter((shot) => shot.status === "ready" && shot.blob);
    try {
      const created = await api.post<CreatedExtraction>("/extractions", {
        ...(text.trim() ? { text } : {}),
        screenshots: ready.map((shot) => ({ contentType: "image/jpeg", size: shot.blob!.size })),
      });
      if (created.urlOnly) {
        setMessage({
          kind: "info",
          text: listing(screenshotsEnabled ? "urlOnly" : "urlOnlyTextOnly"),
        });
        return;
      }
      // A failed upload is counted by the job as a screenshot it could not read.
      await Promise.all(
        created.uploads.map((form, index) => uploadScreenshot(form, ready[index]!.blob!)),
      );
      await api.post(`/extractions/${created.extractionId}/submit`);
      setRedactions(created.redactions);
      setExtractionId(created.extractionId);
      setExtraction(null);
      setItems([]);
      setStage("review");
    } catch (error) {
      const problem = problemOf(error);
      setMessage({
        kind: "error",
        text:
          problem?.code === "extraction_limit_reached"
            ? limitMessage(problem)
            : errors(problem && KNOWN_ERRORS.has(problem.code) ? problem.code : "internal_error"),
      });
    } finally {
      setBusy(false);
    }
  }

  function pasteInstead() {
    // Screenshots are not sent twice: the host pastes what could not be read (FR-016).
    setScreenshots([]);
    setMessage(null);
    setStage("input");
  }

  const kept = items.filter((item) => item.keep && !isEmpty(item));

  async function create(body: CoreFactsBody): Promise<boolean> {
    if (!extractionId) return false;
    setMessage(null);
    setFieldErrors(undefined);
    setItemProblem(null);
    try {
      const created = await run(() =>
        api.post<PropertyDetail>(
          "/properties",
          {
            ...body,
            source: "listing_text",
            extractionRequestId: extractionId,
            contentItems: kept.map(toContentItem),
          },
          { idempotent: true },
        ),
      );
      if (!created) return false;
      router.push(`/${locale}/properties/${created.id}`);
      return true;
    } catch (error) {
      const problem = problemOf(error);
      const fields = problem?.code === "validation_failed" ? (problem.fields ?? {}) : {};
      const itemField = Object.keys(fields).find((field) => field.startsWith("contentItems."));
      if (itemField) {
        // Codes belong in the guide's locked fields, never in listing content (FR-013).
        const item = kept[Number(itemField.split(".")[1])];
        setItemProblem(
          listing("restrictedItem", { kind: item ? listing(`kinds.${item.kind}`) : "" }),
        );
      } else if (problem?.code === "validation_failed") {
        setFieldErrors(problem.fields);
      } else if (problem?.code === "plan_limit_reached") {
        setMessage({
          kind: "error",
          text: t("limits.reached", { limit: problemNumber(problem, "limit") ?? 2 }),
        });
      } else if (problem?.code === "conflict") {
        setMessage({ kind: "error", text: listing("alreadyUsed") });
      } else {
        setMessage({
          kind: "error",
          text: errors(problem && KNOWN_ERRORS.has(problem.code) ? problem.code : "internal_error"),
        });
      }
      return false;
    }
  }

  const alert = message ? (
    <p className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`} role="alert">
      {message.text}
    </p>
  ) : null;

  if (stage === "confirm" && extractionId) {
    const facts = extraction?.result?.proposedFacts;
    const title = items.find((item) => item.kind === "title" && item.keep)?.text.trim() ?? "";
    const initial: Partial<CoreFactsValue> = {
      ...(title && title.length <= 120 ? { name: title } : {}),
      ...(toTimeValue(facts?.checkInTime ?? null)
        ? { checkInTime: toTimeValue(facts!.checkInTime)! }
        : {}),
      ...(toTimeValue(facts?.checkoutTime ?? null)
        ? { checkoutTime: toTimeValue(facts!.checkoutTime)! }
        : {}),
      ...(facts?.maxGuests ? { maxGuests: String(facts.maxGuests) } : {}),
    };
    return (
      <>
        <h1>{t("facts.title")}</h1>
        <p className="muted">{listing("proposedNote")}</p>
        {alert}
        {itemProblem ? (
          <>
            <p className="alert alert-error" role="alert">
              {itemProblem}
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setStage("review")}
            >
              {listing("backToReview")}
            </button>
          </>
        ) : null}
        <CoreFactsForm
          api={api}
          locale={locale}
          draftKey={`listing-property:${extractionId}`}
          initial={initial}
          fieldErrors={fieldErrors}
          onSubmit={create}
        />
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setStage("review")}
        >
          {listing("backToReview")}
        </button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <h1>{listing("title")}</h1>
      {stage === "input" ? (
        <>
          <p className="muted">{listing(screenshotsEnabled ? "intro" : "introTextOnly")}</p>
          {alert}
          <ListingInput
            text={text}
            onTextChange={setText}
            screenshotsEnabled={screenshotsEnabled}
            screenshots={screenshots}
            onScreenshotsChange={setScreenshots}
            busy={busy}
            online={online}
            onSubmit={send}
          />
        </>
      ) : extractionId ? (
        <ExtractionReview
          api={api}
          locale={locale}
          extractionId={extractionId}
          redactions={redactions}
          extraction={extraction}
          onExtraction={setExtraction}
          items={items}
          onItemsChange={setItems}
          onRetried={(next) => {
            setExtraction(null);
            setItems([]);
            setExtractionId(next);
          }}
          onPasteInstead={pasteInstead}
          onContinue={() => setStage("confirm")}
          online={online}
        />
      ) : null}
    </>
  );
}
