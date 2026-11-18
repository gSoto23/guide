import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { property, workspace } from "@guidesk/db";
import {
  ANALYTICS_REASONS,
  ANALYTICS_TOPICS,
  countedReason,
  countedTopic,
  isComparable,
  periodBounds,
  questionOutcome,
  UNANSWERED_REASON,
  type AnalyticsPeriod,
} from "@guidesk/domain";
import type {
  AnalyticsPropertyRow,
  AnalyticsReasonKey,
  AnalyticsRequestStatus,
  AnalyticsSummary,
  AnalyticsTopicKey,
  PeriodCount,
  UnansweredPage,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

const UNANSWERED_PAGE = 20;
const REQUEST_STATUSES: AnalyticsRequestStatus[] = [
  "waiting",
  "confirmed",
  "declined",
  "cancelled",
  "host_cancelled",
  "expired",
];

interface Scoped {
  id: string;
  name: string;
  removed: boolean;
  timeZone: string | null;
  createdAt: Date;
  from: string;
  previousFrom: string;
  today: string;
}

/** Per-property sums for the current and previous periods. */
interface Totals {
  viewsProperty: PeriodCount;
  viewsStay: PeriodCount;
  staysOpened: PeriodCount;
  staysWithRequest: number;
  questions: PeriodCount;
  automatic: PeriodCount;
  withHost: PeriodCount;
  escalated: PeriodCount;
  topics: Map<AnalyticsTopicKey, number>;
  reasons: Map<AnalyticsReasonKey, number>;
  unanswered: number;
  exploreOpens: PeriodCount;
  clicks: Map<string, number>;
  requestsMade: PeriodCount;
  requestsByStatus: Map<AnalyticsRequestStatus, number>;
}

const zero = (): PeriodCount => ({ current: 0, previous: 0 });
const emptyTotals = (): Totals => ({
  viewsProperty: zero(),
  viewsStay: zero(),
  staysOpened: zero(),
  staysWithRequest: 0,
  questions: zero(),
  automatic: zero(),
  withHost: zero(),
  escalated: zero(),
  topics: new Map(),
  reasons: new Map(),
  unanswered: 0,
  exploreOpens: zero(),
  clicks: new Map(),
  requestsMade: zero(),
  requestsByStatus: new Map(),
});

const add = (target: PeriodCount, isCurrent: boolean, n: number) => {
  if (isCurrent) target.current += n;
  else target.previous += n;
};
const bump = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);

/**
 * Basic analytics (feature 010, research R1 to R9): read on request from the records and daily
 * counts that already exist, by day in each property's time zone, under the workspace's RLS. Copilot
 * runs and assistant tests are never guest questions (their traces have no conversation).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  /** The properties in scope with their period bounds; a foreign property is a logged 404. */
  private async scope(
    workspaceId: string,
    days: AnalyticsPeriod,
    propertyId: string | undefined,
  ): Promise<Scoped[]> {
    const rows = await this.tx
      .select({
        id: property.id,
        name: property.name,
        status: property.status,
        timeZone: property.timeZone,
        createdAt: property.createdAt,
      })
      .from(property)
      .where(
        and(
          eq(property.workspaceId, workspaceId),
          ...(propertyId ? [eq(property.id, propertyId)] : []),
        ),
      );
    if (propertyId && rows.length === 0) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
    const now = new Date();
    return rows.map((row) => {
      const bounds = periodBounds(days, row.timeZone, now);
      return {
        id: row.id,
        name: row.name,
        removed: row.status !== "active",
        timeZone: row.timeZone,
        createdAt: row.createdAt,
        from: bounds.from,
        previousFrom: bounds.previousFrom,
        today: bounds.today,
      };
    });
  }

  /** The scope as a SQL relation `p(id, tz, cur_from, prev_from, today)`. */
  private scopeSql(scoped: Scoped[]) {
    const json = JSON.stringify(
      scoped.map((row) => ({
        id: row.id,
        tz: row.timeZone ?? "UTC",
        cur_from: row.from,
        prev_from: row.previousFrom,
        today: row.today,
      })),
    );
    return sql`(SELECT * FROM jsonb_to_recordset(${json}::jsonb)
      AS x(id uuid, tz text, cur_from date, prev_from date, today date))`;
  }

  /** The earliest instant any property's previous period can start, for index-friendly filters. */
  private earliest(scoped: Scoped[]): string {
    const day = scoped.reduce(
      (min, row) => (row.previousFrom < min ? row.previousFrom : min),
      "9999",
    );
    const date = new Date(`${day}T00:00:00Z`);
    return new Date(date.getTime() - 86_400_000).toISOString();
  }

  private async collect(workspaceId: string, scoped: Scoped[]): Promise<Map<string, Totals>> {
    const totals = new Map(scoped.map((row) => [row.id, emptyTotals()]));
    if (scoped.length === 0) return totals;
    const p = this.scopeSql(scoped);
    const since = this.earliest(scoped);
    const of = (id: string) => totals.get(id)!;

    const views = await this.tx.execute<{
      property_id: string;
      link_kind: string;
      cur: number;
      prev: number;
    }>(sql`
      SELECT g.property_id, g.link_kind,
             coalesce(sum(g.opens) FILTER (WHERE g.day >= p.cur_from), 0)::int AS cur,
             coalesce(sum(g.opens) FILTER (WHERE g.day < p.cur_from), 0)::int AS prev
        FROM guide_open_daily g
        JOIN ${p} p ON p.id = g.property_id
       WHERE g.workspace_id = ${workspaceId} AND g.day BETWEEN p.prev_from AND p.today
       GROUP BY 1, 2`);
    for (const row of views.rows) {
      const target =
        row.link_kind === "stay"
          ? of(row.property_id).viewsStay
          : of(row.property_id).viewsProperty;
      target.current += row.cur;
      target.previous += row.prev;
    }

    const stays = await this.tx.execute<{
      property_id: string;
      cur: number;
      prev: number;
      with_request: number;
    }>(sql`
      SELECT s.property_id,
             count(*) FILTER (WHERE (s.guide_opened_at AT TIME ZONE p.tz)::date >= p.cur_from)::int AS cur,
             count(*) FILTER (WHERE (s.guide_opened_at AT TIME ZONE p.tz)::date < p.cur_from)::int AS prev,
             count(*) FILTER (
               WHERE (s.guide_opened_at AT TIME ZONE p.tz)::date >= p.cur_from
                 AND EXISTS (SELECT 1 FROM service_request r WHERE r.stay_id = s.id)
             )::int AS with_request
        FROM stay s
        JOIN ${p} p ON p.id = s.property_id
       WHERE s.workspace_id = ${workspaceId}
         AND s.guide_opened_at >= ${since}::timestamptz
         AND (s.guide_opened_at AT TIME ZONE p.tz)::date BETWEEN p.prev_from AND p.today
       GROUP BY 1`);
    for (const row of stays.rows) {
      const t = of(row.property_id);
      t.staysOpened.current += row.cur;
      t.staysOpened.previous += row.prev;
      t.staysWithRequest += row.with_request;
    }

    const traces = await this.tx.execute<{
      property_id: string;
      decision: string;
      reason: string | null;
      topic: string | null;
      is_current: boolean;
      n: number;
    }>(sql`
      SELECT c.property_id, t.decision, t.reason, t.classification->>'topic' AS topic,
             ((t.created_at AT TIME ZONE p.tz)::date >= p.cur_from) AS is_current,
             count(*)::int AS n
        FROM agent_trace t
        JOIN conversation c ON c.id = t.conversation_id
        JOIN ${p} p ON p.id = c.property_id
       WHERE t.workspace_id = ${workspaceId}
         AND t.conversation_id IS NOT NULL
         AND t.created_at >= ${since}::timestamptz
         AND (t.created_at AT TIME ZONE p.tz)::date BETWEEN p.prev_from AND p.today
       GROUP BY 1, 2, 3, 4, 5`);
    for (const row of traces.rows) {
      const outcome = questionOutcome(row.decision, row.reason);
      if (!outcome) continue;
      const t = of(row.property_id);
      add(t.questions, row.is_current, row.n);
      add(
        outcome === "automatic" ? t.automatic : outcome === "with_host" ? t.withHost : t.escalated,
        row.is_current,
        row.n,
      );
      if (!row.is_current) continue;
      const topic = countedTopic(row.topic ?? undefined);
      if (topic) bump(t.topics, topic, row.n);
      const reason = countedReason(row.reason);
      if (reason) bump(t.reasons, reason, row.n);
      if (row.reason === UNANSWERED_REASON) t.unanswered += row.n;
    }

    const explore = await this.tx.execute<{ property_id: string; cur: number; prev: number }>(sql`
      SELECT e.property_id,
             coalesce(sum(e.opens) FILTER (WHERE e.day >= p.cur_from), 0)::int AS cur,
             coalesce(sum(e.opens) FILTER (WHERE e.day < p.cur_from), 0)::int AS prev
        FROM explore_open_daily e
        JOIN ${p} p ON p.id = e.property_id
       WHERE e.workspace_id = ${workspaceId} AND e.day BETWEEN p.prev_from AND p.today
       GROUP BY 1`);
    for (const row of explore.rows) {
      const t = of(row.property_id);
      t.exploreOpens.current += row.cur;
      t.exploreOpens.previous += row.prev;
    }

    const clicks = await this.tx.execute<{ property_id: string; partner: string; n: number }>(sql`
      SELECT k.property_id, k.partner, coalesce(sum(k.clicks), 0)::int AS n
        FROM experience_click_daily k
        JOIN ${p} p ON p.id = k.property_id
       WHERE k.workspace_id = ${workspaceId} AND k.day BETWEEN p.cur_from AND p.today
       GROUP BY 1, 2`);
    for (const row of clicks.rows) bump(of(row.property_id).clicks, row.partner, row.n);

    const requests = await this.tx.execute<{
      property_id: string;
      status: AnalyticsRequestStatus;
      cur: number;
      prev: number;
    }>(sql`
      SELECT d.property_id, d.status,
             coalesce(sum(d.count) FILTER (WHERE d.day >= p.cur_from), 0)::int AS cur,
             coalesce(sum(d.count) FILTER (WHERE d.day < p.cur_from), 0)::int AS prev
        FROM service_request_daily d
        JOIN ${p} p ON p.id = d.property_id
       WHERE d.workspace_id = ${workspaceId} AND d.day BETWEEN p.prev_from AND p.today
       GROUP BY 1, 2`);
    for (const row of requests.rows) {
      const t = of(row.property_id);
      if (row.status === "waiting") {
        t.requestsMade.current += row.cur;
        t.requestsMade.previous += row.prev;
      }
      if (row.cur > 0) bump(t.requestsByStatus, row.status, row.cur);
    }
    return totals;
  }

  private static hasActivity(t: Totals): boolean {
    return (
      t.viewsProperty.current + t.viewsStay.current + t.questions.current + t.exploreOpens.current >
        0 ||
      t.requestsMade.current > 0 ||
      [...t.clicks.values()].some((n) => n > 0)
    );
  }

  async summary(
    workspaceId: string,
    days: AnalyticsPeriod,
    propertyId: string | undefined,
  ): Promise<AnalyticsSummary> {
    const scoped = await this.scope(workspaceId, days, propertyId);
    const perProperty = await this.collect(workspaceId, scoped);
    // Removed properties stay in the workspace view only when they had activity (FR-013).
    const shown = scoped.filter(
      (row) => propertyId || !row.removed || AnalyticsService.hasActivity(perProperty.get(row.id)!),
    );
    const sum = emptyTotals();
    for (const row of shown) {
      const t = perProperty.get(row.id)!;
      for (const key of [
        "viewsProperty",
        "viewsStay",
        "staysOpened",
        "questions",
        "automatic",
        "withHost",
        "escalated",
        "exploreOpens",
        "requestsMade",
      ] as const) {
        sum[key].current += t[key].current;
        sum[key].previous += t[key].previous;
      }
      sum.staysWithRequest += t.staysWithRequest;
      sum.unanswered += t.unanswered;
      for (const [k, n] of t.topics) bump(sum.topics, k, n);
      for (const [k, n] of t.reasons) bump(sum.reasons, k, n);
      for (const [k, n] of t.clicks) bump(sum.clicks, k, n);
      for (const [k, n] of t.requestsByStatus) bump(sum.requestsByStatus, k, n);
    }

    const now = new Date();
    let comparable: boolean;
    let scope: AnalyticsSummary["scope"];
    if (propertyId) {
      const only = scoped[0]!;
      comparable = isComparable(days, only.timeZone, only.createdAt, now);
      scope = {
        kind: "property",
        propertyId: only.id,
        propertyName: only.name,
        removed: only.removed,
      };
    } else {
      const [ws] = await this.tx
        .select({ createdAt: workspace.createdAt })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1);
      comparable = ws ? isComparable(days, null, ws.createdAt, now) : false;
      scope = { kind: "workspace" };
    }

    const ranked = <K extends string>(map: Map<K, number>, order: readonly K[]) =>
      [...map.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));

    const rows: AnalyticsPropertyRow[] | null = propertyId
      ? null
      : shown.map((row) => {
          const t = perProperty.get(row.id)!;
          return {
            propertyId: row.id,
            name: row.name,
            removed: row.removed,
            views: t.viewsProperty.current + t.viewsStay.current,
            questions: t.questions.current,
            automatic: t.automatic.current,
            escalated: t.escalated.current,
            requests: t.requestsMade.current,
            clicks: [...t.clicks.values()].reduce((a, b) => a + b, 0),
          };
        });

    return {
      period: {
        days,
        timeZones: [...new Set(shown.map((row) => row.timeZone ?? "UTC"))].sort(),
        utcFallback: shown.some((row) => row.timeZone === null),
      },
      scope,
      comparable,
      views: { property: sum.viewsProperty, stay: sum.viewsStay },
      staysOpened: sum.staysOpened,
      questions: {
        total: sum.questions,
        automatic: sum.automatic,
        withHost: sum.withHost,
        escalated: sum.escalated,
      },
      topics: ranked(sum.topics, ANALYTICS_TOPICS).map(([topic, count]) => ({ topic, count })),
      escalations: ranked(sum.reasons, ANALYTICS_REASONS).map(([reason, count]) => ({
        reason,
        count,
      })),
      unanswered: sum.unanswered,
      explore: {
        opens: sum.exploreOpens,
        clicks: [...sum.clicks.entries()]
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([partner, count]) => ({ partner, count })),
      },
      requests: {
        made: sum.requestsMade,
        byStatus: REQUEST_STATUSES.filter(
          (status) => (sum.requestsByStatus.get(status) ?? 0) > 0,
        ).map((status) => ({ status, count: sum.requestsByStatus.get(status)! })),
        staysWithRequest: sum.staysWithRequest,
      },
      properties: rows,
    };
  }

  /** Questions the assistant didn't know, newest first (research R6). */
  async unanswered(
    workspaceId: string,
    days: AnalyticsPeriod,
    propertyId: string | undefined,
    cursor: string | undefined,
  ): Promise<UnansweredPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const scoped = await this.scope(workspaceId, days, propertyId);
    if (scoped.length === 0) return { items: [], next: null };
    const p = this.scopeSql(scoped);
    const since = this.earliest(scoped);
    const rows = await this.tx.execute<{
      trace_id: string;
      conversation_id: string;
      property_id: string;
      property_name: string;
      created_at: Date | string;
      body: string | null;
    }>(sql`
      SELECT t.id AS trace_id, t.conversation_id, c.property_id, pr.name AS property_name,
             t.created_at, m.body
        FROM agent_trace t
        JOIN conversation c ON c.id = t.conversation_id
        JOIN ${p} p ON p.id = c.property_id
        JOIN property pr ON pr.id = c.property_id
        LEFT JOIN chat_message m ON m.id = t.guest_message_id
       WHERE t.workspace_id = ${workspaceId}
         AND t.conversation_id IS NOT NULL
         AND t.reason = ${UNANSWERED_REASON}
         AND t.created_at >= ${since}::timestamptz
         AND (t.created_at AT TIME ZONE p.tz)::date BETWEEN p.cur_from AND p.today
         ${after ? sql`AND (t.created_at, t.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${UNANSWERED_PAGE + 1}`);
    const page = rows.rows.slice(0, UNANSWERED_PAGE);
    const items = page.map((row) => ({
      traceId: row.trace_id,
      conversationId: row.conversation_id,
      propertyId: row.property_id,
      propertyName: row.property_name,
      at: new Date(row.created_at).toISOString(),
      text: row.body,
    }));
    const last = items.at(-1);
    return {
      items,
      next: rows.rows.length > UNANSWERED_PAGE && last ? encodeCursor(last.at, last.traceId) : null,
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!at || !id || !UUID.test(id) || Number.isNaN(Date.parse(at))) {
    throw new ApiProblem(422, "validation_failed");
  }
  return { at, id };
}
