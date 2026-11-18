"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AnalyticsPropertyRow } from "@guidesk/contracts";
import { rate, type Formatters } from "@/lib/analytics";

type Column =
  "name" | "views" | "questions" | "automatic" | "rate" | "escalated" | "requests" | "clicks";
const COLUMNS: Column[] = [
  "name",
  "views",
  "questions",
  "automatic",
  "rate",
  "escalated",
  "requests",
  "clicks",
];
const FIRST_ROWS = 50;

const valueOf = (row: AnalyticsPropertyRow, column: Column): number | string =>
  column === "name"
    ? row.name
    : column === "rate"
      ? (rate(row.automatic, row.questions) ?? -1)
      : row[column];

/**
 * One row per property (FR-012): sortable by each column, first 50 rows then all, removed properties
 * marked. The sort is announced in a live region (spec US3).
 */
export function PropertyTable({
  locale,
  rows,
  format,
}: {
  locale: string;
  rows: AnalyticsPropertyRow[];
  format: Formatters;
}) {
  const t = useTranslations("analytics.table");
  const id = useId();
  const [sort, setSort] = useState<{ column: Column; ascending: boolean }>({
    column: "views",
    ascending: false,
  });
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => {
    const x = valueOf(a, sort.column);
    const y = valueOf(b, sort.column);
    const order =
      typeof x === "string" ? x.localeCompare(String(y), locale) : (x as number) - (y as number);
    return sort.ascending ? order : -order;
  });
  const shown = all ? sorted : sorted.slice(0, FIRST_ROWS);

  const choose = (column: Column) =>
    setSort((current) =>
      current.column === column
        ? { column, ascending: !current.ascending }
        : { column, ascending: column === "name" },
    );

  return (
    <div className="table-scroll">
      <table className="data-table" aria-describedby={`${id}-sorted`}>
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column}
                scope="col"
                aria-sort={
                  sort.column === column ? (sort.ascending ? "ascending" : "descending") : "none"
                }
              >
                <button type="button" className="link-button" onClick={() => choose(column)}>
                  {t(column)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const share = rate(row.automatic, row.questions);
            return (
              <tr key={row.propertyId}>
                <th scope="row">
                  <Link href={`/${locale}/properties/${row.propertyId}/analytics`}>{row.name}</Link>
                  {row.removed ? <span className="badge badge-warning">{t("removed")}</span> : null}
                </th>
                <td>{format.number(row.views)}</td>
                <td>{format.number(row.questions)}</td>
                <td>{format.number(row.automatic)}</td>
                <td>{share === null ? "—" : format.percent(share)}</td>
                <td>{format.number(row.escalated)}</td>
                <td>{format.number(row.requests)}</td>
                <td>{format.number(row.clicks)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="visually-hidden" id={`${id}-sorted`} role="status">
        {t("sorted", {
          column: t(sort.column),
          direction: t(sort.ascending ? "ascending" : "descending"),
        })}
      </p>
      {!all && rows.length > FIRST_ROWS ? (
        <button type="button" className="button button-secondary" onClick={() => setAll(true)}>
          {t("showAll", { count: rows.length })}
        </button>
      ) : null}
    </div>
  );
}
