"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { SharedBlockList, SharedBlockView } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

const SECTION_KINDS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
] as const;

/**
 * Shared content (screen H-29, feature 003 US7, FR-057 to FR-062): the workspace's blocks by
 * section, with their status and how many properties inherit, override, or exclude each, and a
 * form to create one.
 */
export function SharedContent({ locale }: { locale: string }) {
  const t = useTranslations("sharedContent");
  const guide = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [list, setList] = useState<SharedBlockList | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [sectionKind, setSectionKind] = useState<(typeof SECTION_KINDS)[number]>("checkout");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    workspace.api.get<SharedBlockList>("/shared-blocks").then(setList, () => {
      setError(errors("internal_error"));
    });
  }, [workspace, errors]);

  if (!workspace) return null;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !name.trim()) return;
    setError(null);
    try {
      const block = await workspace.api.post<SharedBlockView>(
        "/shared-blocks",
        { sectionKind, name: name.trim() },
        { idempotent: true },
      );
      window.location.assign(`/${locale}/shared-content/${block.id}`);
    } catch (caught) {
      const code = problemOf(caught)?.code ?? "internal_error";
      setError(errors.has(code) ? errors(code) : errors("internal_error"));
    }
  }

  return (
    <section aria-labelledby="shared-title">
      <h1 id="shared-title">{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {list && list.items.length === 0 && <p>{t("empty")}</p>}
      {SECTION_KINDS.map((kind) => {
        const blocks = (list?.items ?? []).filter((block) => block.sectionKind === kind);
        if (blocks.length === 0) return null;
        return (
          <div key={kind} className="card">
            <h2>{guide(`sections.${kind}`)}</h2>
            <ul className="property-list">
              {blocks.map((block) => (
                <li key={block.id} className="property-row">
                  <Link href={`/${locale}/shared-content/${block.id}`}>
                    <strong>{block.name}</strong>
                  </Link>
                  <span className="property-meta">
                    <span className={block.status === "published" ? "badge badge-ready" : "badge"}>
                      {t(`status_${block.status}`)}
                    </span>{" "}
                    {block.hasUnpublishedChanges && (
                      <span className="badge badge-warning">{t("changes")}</span>
                    )}{" "}
                    {t("counts", block.counts)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {workspace.canManage &&
        (creating ? (
          <form className="card" onSubmit={create}>
            <label htmlFor="block-section">{t("section")}</label>
            <select
              id="block-section"
              value={sectionKind}
              onChange={(event) => setSectionKind(event.target.value as typeof sectionKind)}
            >
              {SECTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {guide(`sections.${kind}`)}
                </option>
              ))}
            </select>
            <label htmlFor="block-name">{t("name")}</label>
            <input
              id="block-name"
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <div className="actions">
              <button type="submit" className="button button-primary">
                {t("create")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCreating(false)}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        ) : (
          <p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setCreating(true)}
            >
              {t("create")}
            </button>{" "}
            {list && <span className="muted">{t("limit", { limit: list.limit })}</span>}
          </p>
        ))}
    </section>
  );
}
