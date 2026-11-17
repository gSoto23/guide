"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { ListingContentItem, ListingContentList } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

export interface ListingContentProps {
  propertyId: string;
  /** For the "From Beds24" label of imported content. */
  sourceProvider: string | null;
}

/**
 * The property's listing content (FR-018, FR-019, T063): each item keeps its source label until
 * an owner or admin edits or approves it. Agents only read. Text that looks like a code is
 * refused, with a pointer to the guide's locked fields (FR-013). Loaded on demand by the property
 * page.
 */
export function ListingContent({ propertyId, sourceProvider }: ListingContentProps) {
  const t = useTranslations("properties.listing");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [items, setItems] = useState<ListingContentItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    workspace.api
      .get<ListingContentList>(`/properties/${propertyId}/listing-content`, controller.signal)
      .then((list) => setItems(list.items))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workspace, propertyId]);

  if (!workspace) return null;
  if (failed) return <p className="alert alert-error">{errors("internal_error")}</p>;
  // A property created by hand has no listing content: nothing to show.
  if (!items || items.length === 0) return null;

  return (
    <section aria-labelledby="listing-content-title">
      <h2 id="listing-content-title">{t("panelTitle")}</h2>
      <p className="muted">{t(workspace.canManage ? "panelIntro" : "panelIntroReadOnly")}</p>
      {items.map((item) => (
        <ContentCard
          key={item.kind}
          item={item}
          propertyId={propertyId}
          sourceProvider={sourceProvider}
          canManage={workspace.canManage}
          onSaved={(saved) =>
            setItems((current) =>
              (current ?? []).map((existing) => (existing.kind === saved.kind ? saved : existing)),
            )
          }
        />
      ))}
    </section>
  );
}

function ContentCard({
  item,
  propertyId,
  sourceProvider,
  canManage,
  onSaved,
}: {
  item: ListingContentItem;
  propertyId: string;
  sourceProvider: string | null;
  canManage: boolean;
  onSaved: (item: ListingContentItem) => void;
}) {
  const t = useTranslations("properties.listing");
  const properties = useTranslations("properties");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const ids = { text: useId(), error: useId() };
  const current = item.kind === "amenities" ? (item.items ?? []).join("\n") : (item.body ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    item.reviewState === "edited"
      ? t("editedByYou")
      : item.reviewState === "approved"
        ? t("approved")
        : item.source === "pms"
          ? properties("source.pms", {
              provider: sourceProvider ? properties(`providers.${sourceProvider}`) : "",
            })
          : properties(`source.${item.source}`);

  function failure(caught: unknown) {
    const problem = problemOf(caught);
    const restricted = Object.values(problem?.fields ?? {}).some((messages) =>
      messages.includes("restricted_value"),
    );
    setError(
      restricted
        ? t("restricted")
        : errors(
            problem?.code === "forbidden" || problem?.code === "network"
              ? problem.code
              : "internal_error",
          ),
    );
  }

  async function save() {
    if (!workspace || saving) return;
    setSaving(true);
    setError(null);
    const body =
      item.kind === "amenities"
        ? {
            items: draft
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          }
        : { body: draft.trim() };
    try {
      onSaved(
        await workspace.api.put<ListingContentItem>(
          `/properties/${propertyId}/listing-content/${item.kind}`,
          body,
        ),
      );
      setEditing(false);
    } catch (caught) {
      failure(caught);
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!workspace || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await workspace.api.post<ListingContentItem>(
          `/properties/${propertyId}/listing-content/${item.kind}/approve`,
        ),
      );
    } catch (caught) {
      failure(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="content-item" lang={item.language ?? undefined}>
      <div className="content-item-head">
        <h3>{t(`kinds.${item.kind}`)}</h3>
        <span
          className={`badge ${item.reviewState === "unreviewed" ? "badge-warning" : "badge-ready"}`}
        >
          {label}
        </span>
      </div>
      {error ? (
        <p className="alert alert-error" role="alert" id={ids.error}>
          {error}
        </p>
      ) : null}
      {editing ? (
        <>
          <label htmlFor={ids.text} className="visually-hidden">
            {t(`kinds.${item.kind}`)}
          </label>
          <textarea
            id={ids.text}
            rows={item.kind === "title" ? 2 : 8}
            maxLength={20_000}
            value={draft}
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setDraft(event.target.value)}
          />
          {item.kind === "amenities" ? (
            <span className="field-hint">{t("amenitiesHint")}</span>
          ) : null}
          <button
            type="button"
            className="button button-primary"
            disabled={saving || !online || draft.trim() === ""}
            onClick={save}
          >
            {t("save")}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setDraft(current);
              setEditing(false);
              setError(null);
            }}
          >
            {t("cancel")}
          </button>
        </>
      ) : (
        <>
          {item.kind === "amenities" ? (
            <ul className="amenities">
              {(item.items ?? []).map((amenity) => (
                <li key={amenity}>{amenity}</li>
              ))}
            </ul>
          ) : (
            <p className="content-body">{item.body}</p>
          )}
          {canManage ? (
            <div className="content-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={saving || !online}
                onClick={() => {
                  setDraft(current);
                  setEditing(true);
                }}
              >
                {t("edit")}
              </button>
              {item.reviewState === "unreviewed" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={saving || !online}
                  onClick={approve}
                >
                  {t("approve")}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
