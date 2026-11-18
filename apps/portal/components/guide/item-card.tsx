"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  CodeWarning,
  GuideDocument,
  GuideView,
  ItemView,
  Recommendation,
} from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import {
  AUTOSAVE_DELAY_MS,
  clearLocalDraft,
  draftKey,
  readLocalDraft,
  saveLocalDraft,
} from "@/lib/guide/autosave";
import { sourceLabel } from "@/lib/guide/labels";
import { useOnline } from "@/lib/use-online";
import type { TextItemEditorProps } from "./text-item-editor";

// Opened only when adding or editing a recommendation (Performance Budget, 150 KB per route).
const RecommendationForm = dynamic(
  () => import("./recommendation-form").then((m) => m.RecommendationForm),
  { ssr: false },
);

/** Loaded only when a section is open, so the editor never weighs on the guide pages (research R3). */
const TextItemEditor = dynamic<TextItemEditorProps>(() => import("./text-item-editor"), {
  ssr: false,
  loading: () => <div className="guide-editor-content" aria-busy="true" />,
});

export interface ItemActions {
  save: (
    item: ItemView,
    body: { doc?: GuideDocument; recommendation?: Recommendation; keepCodeWarning?: boolean },
  ) => Promise<CodeWarning[]>;
  approve: (item: ItemView) => Promise<void>;
  /** Moves a block that looks like a code into a new locked field (FR-019, US2). */
  moveToLocked: (item: ItemView, warning: CodeWarning) => Promise<boolean>;
  remove: (item: ItemView) => Promise<void>;
  move: (item: ItemView, direction: -1 | 1) => Promise<void>;
}

function docOf(text: string): GuideDocument {
  const trimmed = text.trim();
  return trimmed
    ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: trimmed }] }] }
    : { type: "doc", content: [] };
}

function plainOf(doc: GuideDocument | null | undefined): string {
  return (doc?.content ?? [])
    .map((block) =>
      "content" in block && block.type !== "bulletList" && block.type !== "orderedList"
        ? (block.content ?? []).map((node) => (node.type === "text" ? node.text : "")).join("")
        : "",
    )
    .join("\n");
}

/**
 * One item of a section (FR-005, FR-008, FR-013, FR-014): its source label and review state, its
 * content in the editing language, and its actions. Text saves itself 1 second after typing stops;
 * unsent text stays on the device (FR-011, FR-070).
 */
export function ItemCard({
  item,
  view,
  language,
  canEdit,
  first,
  last,
  locale,
  propertyId,
  actions,
}: {
  item: ItemView;
  view: GuideView;
  language: "es" | "en";
  canEdit: boolean;
  first: boolean;
  last: boolean;
  locale: string;
  propertyId: string;
  actions: ItemActions;
}) {
  const t = useTranslations("guide");
  const online = useOnline();
  const shared = item.sharedBlockId !== null;
  const editable = canEdit && !shared && item.kind !== "fact";
  const text = item.texts[language] ?? item.texts[item.sourceLanguage];
  const key = draftKey(item.id, language);
  const [state, setState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [warnings, setWarnings] = useState<CodeWarning[]>([]);
  const [editingRecommendation, setEditingRecommendation] = useState(false);
  /** Remounts the editor when the server changed the text, such as after a move (FR-019). */
  const [editorKey, setEditorKey] = useState(0);
  const pending = useRef<GuideDocument | null>(readLocalDraft<GuideDocument>(key));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const labelFor = (fieldId: string) =>
    view.lockedFields.find((field) => field.id === fieldId)?.label ?? t("editor.lockedField");

  async function flush() {
    const doc = pending.current;
    if (!doc || !online) {
      if (doc) setState("unsaved");
      return;
    }
    setState("saving");
    try {
      setWarnings(await actions.save(item, { doc }));
      if (pending.current === doc) {
        pending.current = null;
        clearLocalDraft(key);
      }
      setState("saved");
    } catch {
      setState("unsaved");
    }
  }

  // Sends text kept on the device once the connection returns (FR-070).
  useEffect(() => {
    if (online && pending.current) void flush();
  }, [online]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function changed(doc: GuideDocument) {
    pending.current = doc;
    saveLocalDraft(key, doc);
    setState("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  const label = shared ? null : sourceLabel(t, item);
  const fact = item.factKey
    ? {
        check_in_time:
          view.facts.checkInTime && t("facts.check_in_time", { time: view.facts.checkInTime }),
        checkout_time:
          view.facts.checkoutTime && t("facts.checkout_time", { time: view.facts.checkoutTime }),
        max_guests:
          view.facts.maxGuests !== null && t("facts.max_guests", { count: view.facts.maxGuests }),
        address: view.facts.address && t("facts.address", { address: view.facts.address }),
      }[item.factKey]
    : null;

  return (
    <li className="content-item">
      <div className="content-item-head">
        {label && (
          <span className={item.reviewed ? "badge badge-ready" : "badge badge-warning"}>
            {item.reviewed ? label : `${label} · ${t("editor.needsReview")}`}
          </span>
        )}
        {shared && (
          <span className="badge">
            {t("shared.badge", {
              name: view.sharedBlocks.find((block) => block.id === item.sharedBlockId)?.name ?? "",
            })}
          </span>
        )}
        {editable && state !== "saved" && (
          <span className="muted" aria-live="polite">
            {state === "saving"
              ? t("editor.saving")
              : online
                ? t("editor.unsaved")
                : t("editor.offline")}
          </span>
        )}
      </div>

      {item.kind === "fact" && (
        <p>
          {fact || "—"}{" "}
          {canEdit && (
            <a className="button-link" href={`/${locale}/properties/${propertyId}`}>
              {t("facts.editInProperty")}
            </a>
          )}
        </p>
      )}

      {item.kind === "text" &&
        (editable ? (
          <TextItemEditor
            key={editorKey}
            doc={(pending.current ?? text?.doc ?? null) as GuideDocument | null}
            labelFor={labelFor}
            onChange={changed}
            ariaLabel={t("editor.textPlaceholder")}
            lockedFields={view.lockedFields.filter((field) => "isSet" in field)}
          />
        ) : (
          <GuideDocumentView
            doc={text?.doc as RenderableDocument | null}
            renderLockedField={(id) => `🔒 ${labelFor(id)}`}
          />
        ))}

      {(item.kind === "image" || item.kind === "video") && item.media && (
        <figure>
          {item.kind === "image" && item.media.urls.small && (
            <img
              src={item.media.urls.small}
              alt={plainOf(text?.doc)}
              width={item.media.width ?? undefined}
              height={item.media.height ?? undefined}
              loading="lazy"
              style={{ maxWidth: "100%", height: "auto" }}
            />
          )}
          {item.kind === "video" && item.media.urls.original && (
            <video
              src={item.media.urls.original}
              controls
              preload="metadata"
              style={{ maxWidth: "100%" }}
            />
          )}
          {item.kind === "video" && item.media.videoCodec === "hevc" && (
            <p className="field-hint">{t("media.hevcNote")}</p>
          )}
          {editable ? (
            <input
              aria-label={t("editor.caption")}
              placeholder={t("editor.caption")}
              defaultValue={plainOf(text?.doc)}
              maxLength={300}
              onBlur={(event) => {
                if (event.target.value.trim() !== plainOf(text?.doc))
                  void actions.save(item, { doc: docOf(event.target.value) });
              }}
            />
          ) : (
            <figcaption>{plainOf(text?.doc)}</figcaption>
          )}
        </figure>
      )}

      {item.kind === "recommendation" &&
        item.recommendation &&
        (editingRecommendation ? (
          <RecommendationForm
            initial={item.recommendation}
            initialTip={plainOf(text?.doc)}
            onCancel={() => setEditingRecommendation(false)}
            onSave={async (recommendation, tip) => {
              await actions.save(item, { recommendation, doc: docOf(tip) });
              setEditingRecommendation(false);
            }}
          />
        ) : (
          <div>
            <strong>{item.recommendation.name}</strong> ·{" "}
            {t(`recommendation.categories.${item.recommendation.category}`)}
            {item.recommendation.benefit && item.recommendation.benefit !== "none" && (
              <p className="field-hint">{t("recommendation.disclosure")}</p>
            )}
            <GuideDocumentView
              doc={text?.doc as RenderableDocument | null}
              renderLockedField={() => ""}
            />
            {editable && (
              <button
                type="button"
                className="button-link"
                onClick={() => setEditingRecommendation(true)}
              >
                {t("editor.edit")}
              </button>
            )}
          </div>
        ))}

      {warnings.length > 0 && (
        <p className="alert alert-info" role="status">
          {t("editor.codeWarning")}{" "}
          <button
            type="button"
            className="button-link"
            onClick={async () => {
              const [warning] = warnings;
              if (!warning) return;
              await flush();
              if (await actions.moveToLocked(item, warning)) {
                pending.current = null;
                clearLocalDraft(key);
                setWarnings([]);
                setEditorKey((current) => current + 1);
              }
            }}
          >
            {t("locked.move")}
          </button>{" "}
          <button
            type="button"
            className="button-link"
            onClick={async () => {
              await actions.save(item, { keepCodeWarning: true });
              setWarnings([]);
            }}
          >
            {t("editor.keepAsText")}
          </button>
        </p>
      )}

      {editable && (
        <div className="content-actions">
          {!item.reviewed && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void actions.approve(item)}
            >
              {t("editor.approve")}
            </button>
          )}
          <button
            type="button"
            className="button button-secondary"
            disabled={first}
            onClick={() => void actions.move(item, -1)}
            aria-label={t("editor.moveUp")}
          >
            ↑
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={last}
            onClick={() => void actions.move(item, 1)}
            aria-label={t("editor.moveDown")}
          >
            ↓
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              if (window.confirm(t("editor.deleteConfirm"))) void actions.remove(item);
            }}
          >
            {t("editor.delete")}
          </button>
        </div>
      )}
    </li>
  );
}
