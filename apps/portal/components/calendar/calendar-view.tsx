"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CalendarResponse, CalendarStay } from "@guidesk/contracts";
import {
  agenda,
  barSpan,
  daysInMonth,
  DEFAULT_FILTERS,
  loadFilters,
  monthOf,
  monthRange,
  saveFilters,
  shiftMonth,
  staysOn,
  todayIn,
  weekdayIndex,
  type CalendarFilters,
  type Month,
} from "@/lib/calendar";
import { useWorkspace } from "@/lib/use-workspace";

/** "noviembre de 2026" → "Noviembre de 2026": only the first letter, as Spanish writes dates. */
function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** Below this width the calendar is an agenda by day (FR-003). */
const NARROW = "(max-width: 767px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    setNarrow(query.matches);
    const listener = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return narrow;
}

/**
 * The stay calendar (feature 018 US1): every stay Guidesk knows, read-only. All properties as rows
 * of bars on wide screens, one property as a month grid, and an agenda by day on phones. Filters
 * stay on this device. Each stay opens its stay view.
 */
export function CalendarView({ locale }: { locale: string }) {
  const t = useTranslations("calendar");
  const workspace = useWorkspace();
  const narrow = useNarrow();
  const [month, setMonth] = useState<Month>(() => monthOf(todayIn()));
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const api = workspace?.api;

  useEffect(() => setFilters(loadFilters()), []);

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    const { from, to } = monthRange(month);
    const params = new URLSearchParams({ from, to });
    if (filters.propertyId) params.set("propertyId", filters.propertyId);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.cancelled) params.set("cancelled", "true");
    setFailed(false);
    api
      .get<CalendarResponse>(`/calendar?${params.toString()}`, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) {
          // A property that no longer exists in a saved filter: fall back to all properties.
          if (filters.propertyId) update({ ...filters, propertyId: "" });
          else setFailed(true);
        }
      });
    return () => controller.abort();
  }, [api, month, filters]);

  function update(next: CalendarFilters) {
    setFilters(next);
    saveFilters(next);
  }

  const channels = useMemo(
    () => [...new Set((data?.stays ?? []).map((stay) => stay.channel))].sort(),
    [data],
  );
  const title = upperFirst(
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(month.year, month.month - 1, 15)),
    ),
  );

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      <div className="toolbar calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="button button-secondary"
            aria-label={t("previous")}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ‹
          </button>
          <h2 className="calendar-month" aria-live="polite">
            {title}
          </h2>
          <button
            type="button"
            className="button button-secondary"
            aria-label={t("next")}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            ›
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setMonth(monthOf(todayIn()))}
          >
            {t("today")}
          </button>
        </div>
        <label className="calendar-filter">
          <span>{t("property")}</span>
          <select
            value={filters.propertyId}
            onChange={(event) => update({ ...filters, propertyId: event.target.value })}
          >
            <option value="">{t("allProperties")}</option>
            {(data?.properties ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="calendar-filter">
          <span>{t("channel")}</span>
          <select
            value={filters.channel}
            onChange={(event) => update({ ...filters, channel: event.target.value })}
          >
            <option value="">{t("allChannels")}</option>
            {channels.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </label>
        <label className="calendar-check">
          <input
            type="checkbox"
            checked={filters.cancelled}
            onChange={(event) => update({ ...filters, cancelled: event.target.checked })}
          />
          <span>{t("showCancelled")}</span>
        </label>
      </div>
      {failed ? (
        <p className="alert alert-error" role="alert">
          {t("error")}
        </p>
      ) : !data ? (
        <p className="muted">{t("loading")}</p>
      ) : data.properties.length === 0 ? (
        <p className="muted">{t("noProperties")}</p>
      ) : narrow ? (
        <Agenda locale={locale} month={month} stays={data.stays} names={data.properties} />
      ) : filters.propertyId ? (
        <MonthGrid locale={locale} month={month} stays={data.stays} />
      ) : (
        <Timeline locale={locale} month={month} data={data} />
      )}
      <p className="muted calendar-note">{t("readOnly")}</p>
    </>
  );
}

function StayLabel({ stay }: { stay: CalendarStay }) {
  const t = useTranslations("calendar");
  return (
    <>
      <span className="calendar-guest">
        {stay.guestName ?? t("guestOf", { channel: stay.channel })}
      </span>
      {stay.guestCount ? (
        <span className="calendar-count"> · {t("guests", { count: stay.guestCount })}</span>
      ) : null}
    </>
  );
}

/** Marks with a visible symbol and a spoken label, never color alone (FR-023). */
function Marks({ stay }: { stay: CalendarStay }) {
  const t = useTranslations("calendar");
  const marks: { symbol: string; label: string }[] = [];
  if (stay.status === "cancelled") marks.push({ symbol: "✕", label: t("cancelled") });
  if (stay.mayBeBlock) marks.push({ symbol: "?", label: t("mayBeBlock") });
  if (stay.marks.openEscalation) marks.push({ symbol: "!", label: t("markEscalation") });
  if (stay.marks.waitingRequests > 0) {
    marks.push({
      symbol: `◷${stay.marks.waitingRequests}`,
      label: t("markWaiting", { count: stay.marks.waitingRequests }),
    });
  }
  if (stay.marks.confirmedExtras > 0) {
    marks.push({
      symbol: `+${stay.marks.confirmedExtras}`,
      label: t("markExtras", { count: stay.marks.confirmedExtras }),
    });
  }
  if (stay.marks.linkOpened) marks.push({ symbol: "✓", label: t("markLink") });
  if (marks.length === 0) return null;
  return (
    <span className="calendar-marks">
      {marks.map((mark) => (
        <span key={mark.label} className="calendar-mark" title={mark.label}>
          <span aria-hidden="true">{mark.symbol}</span>
          <span className="visually-hidden">{mark.label}</span>
        </span>
      ))}
    </span>
  );
}

function stayClass(stay: CalendarStay): string {
  return [
    "calendar-bar",
    stay.mayBeBlock ? "calendar-bar-block" : "",
    stay.status === "cancelled" ? "calendar-bar-cancelled" : "",
    stay.marks.openEscalation ? "calendar-bar-alert" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function Timeline({
  locale,
  month,
  data,
}: {
  locale: string;
  month: Month;
  data: CalendarResponse;
}) {
  const t = useTranslations("calendar");
  const days = daysInMonth(month);
  const columns = `repeat(${days.length}, minmax(2rem, 1fr))`;
  const today = todayIn();
  return (
    <div className="calendar-scroll">
      <div className="calendar-timeline">
        <div className="calendar-row calendar-head">
          <span className="calendar-prop" />
          <div className="calendar-track" style={{ gridTemplateColumns: columns }}>
            {days.map((day) => (
              <span
                key={day}
                className={`calendar-day${day === today ? " calendar-today" : ""}`}
                aria-hidden="true"
              >
                {Number(day.slice(8, 10))}
              </span>
            ))}
          </div>
        </div>
        {data.properties.map((item) => {
          const stays = data.stays.filter((stay) => stay.propertyId === item.id);
          return (
            <div key={item.id} className="calendar-row">
              <span className="calendar-prop">{item.name}</span>
              <ul className="calendar-track" style={{ gridTemplateColumns: columns }}>
                {stays.length === 0 ? <li className="calendar-empty muted">{t("empty")}</li> : null}
                {stays.map((stay) => {
                  const span = barSpan(stay, month);
                  if (!span) return null;
                  return (
                    <li
                      key={stay.id}
                      className="calendar-cell"
                      style={{ gridColumn: `${span.start} / ${span.end + 1}` }}
                    >
                      <Link
                        href={`/${locale}/calendar/stays/${stay.id}`}
                        className={`${stayClass(stay)}${span.cutStart ? " calendar-cut-start" : ""}${span.cutEnd ? " calendar-cut-end" : ""}`}
                        aria-label={`${stay.guestName ?? t("guestOf", { channel: stay.channel })}, ${item.name}, ${stay.checkInDate} → ${stay.checkoutDate}`}
                      >
                        <StayLabel stay={stay} />
                        <Marks stay={stay} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthGrid({
  locale,
  month,
  stays,
}: {
  locale: string;
  month: Month;
  stays: CalendarStay[];
}) {
  const t = useTranslations("calendar");
  const days = daysInMonth(month);
  const lead = weekdayIndex(days[0]!);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
      new Date(Date.UTC(2031, 2, 3 + index)),
    ),
  );
  const today = todayIn();
  return (
    <div className="calendar-grid">
      {weekdays.map((name) => (
        <span key={name} className="calendar-weekday" aria-hidden="true">
          {name}
        </span>
      ))}
      {Array.from({ length: lead }, (_, index) => (
        <span key={`lead-${index}`} className="calendar-blank" aria-hidden="true" />
      ))}
      {days.map((day) => {
        const on = staysOn(stays, day);
        const leaving = stays.filter((stay) => stay.checkoutDate === day);
        return (
          <div key={day} className={`calendar-date${day === today ? " calendar-today" : ""}`}>
            <span className="calendar-date-number">{Number(day.slice(8, 10))}</span>
            <ul>
              {on.map((stay) => (
                <li key={stay.id}>
                  <Link href={`/${locale}/calendar/stays/${stay.id}`} className={stayClass(stay)}>
                    {stay.checkInDate === day ? `${t("arrives")}: ` : ""}
                    <StayLabel stay={stay} />
                    <Marks stay={stay} />
                  </Link>
                </li>
              ))}
              {leaving.map((stay) => (
                <li key={`out-${stay.id}`} className="muted">
                  {t("leaves")}: {stay.guestName ?? t("guestOf", { channel: stay.channel })}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Agenda({
  locale,
  month,
  stays,
  names,
}: {
  locale: string;
  month: Month;
  stays: CalendarStay[];
  names: { id: string; name: string }[];
}) {
  const t = useTranslations("calendar");
  const days = agenda(stays, month);
  const propertyName = (id: string) => names.find((item) => item.id === id)?.name ?? "";
  if (days.length === 0) return <p className="muted">{t("empty")}</p>;
  const groups: ["arrivals" | "staying" | "departures", string][] = [
    ["arrivals", t("arrives")],
    ["staying", t("staying")],
    ["departures", t("leaves")],
  ];
  return (
    <ol className="calendar-agenda">
      {days.map((day) => (
        <li key={day.date}>
          <h3>
            {upperFirst(
              new Intl.DateTimeFormat(locale, {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(`${day.date}T12:00:00Z`)),
            )}
          </h3>
          <ul>
            {groups.flatMap(([key, label]) =>
              day[key].map((stay) => (
                <li key={`${key}-${stay.id}`}>
                  <Link href={`/${locale}/calendar/stays/${stay.id}`} className={stayClass(stay)}>
                    <span className="calendar-agenda-kind">{label}</span> <StayLabel stay={stay} />{" "}
                    · {propertyName(stay.propertyId)}
                    <Marks stay={stay} />
                  </Link>
                </li>
              )),
            )}
          </ul>
        </li>
      ))}
    </ol>
  );
}
