import { sql } from "drizzle-orm";
import type { Database } from "../client.js";

/**
 * The founder's pilot metrics (feature 010 US5, research R11; PRD §8): aggregates over a sign-up
 * cohort, read with system privileges outside the portal. The result holds counts, shares, minutes,
 * and money only: never names, emails, or IDs (FR-018).
 */
export interface Share {
  numerator: number;
  denominator: number;
  /** numerator ÷ denominator, or null when there is nothing to divide by. */
  value: number | null;
}

export interface PilotMetrics {
  cohort: { from: string; to: string; signUps: number };
  activation: Share & { target: string };
  timeToGuideMinutes: { median: number | null; published: number; target: string };
  automatedResolution: Share & { target: string };
  attachRate: Share & { target: string };
  retentionDay60: Share & { target: string };
  aiCostPerStay: {
    totalUsd: number;
    staysServed: number;
    perStayUsd: number | null;
    target: string;
  };
  /**
   * Feature 019 (FR-015): the cohort's AI replies by the workspace's current plan, split into
   * replies from the monthly allowances and from top-ups, with the AI cost per reply.
   */
  aiRepliesByPlan: AiRepliesByPlan[];
}

export interface AiRepliesByPlan {
  plan: string;
  replies: number;
  fromAllowance: number;
  fromTopUps: number;
  costUsd: number;
  costPerReplyUsd: number | null;
}

const share = (numerator: number, denominator: number): Share => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
});

/**
 * The cohort: users who signed up between `from` and `to` (UTC days, inclusive). Demo workspaces
 * (feature 014) are left out of every metric, and so are users whose only workspaces are demo ones.
 */
export async function pilotMetrics(
  db: Database,
  cohort: { from: string; to: string },
  now: Date = new Date(),
): Promise<PilotMetrics> {
  const nowIso = now.toISOString();
  const users = sql`
    SELECT u.id, u.created_at FROM "user" u
     WHERE u.created_at >= ${cohort.from}::date
       AND u.created_at < (${cohort.to}::date + 1)
       AND NOT (
         EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id)
         AND NOT EXISTS (
           SELECT 1 FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = u.id AND NOT w.demo
         )
       )`;
  const owned = sql`
    SELECT DISTINCT m.workspace_id FROM membership m
      JOIN workspace w ON w.id = m.workspace_id AND NOT w.demo
     WHERE m.role = 'owner' AND m.user_id IN (SELECT id FROM (${users}) c)`;

  const [activation] = (
    await db.execute<{ activated: number; total: number }>(sql`
      WITH c AS (${users})
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM membership m
                 JOIN workspace w ON w.id = m.workspace_id AND NOT w.demo
                 JOIN property p ON p.workspace_id = m.workspace_id
                 JOIN guide_open_daily g ON g.property_id = p.id
                WHERE m.user_id = c.id AND m.role = 'owner'
                  AND g.day <= (c.created_at + interval '7 days')::date
             ))::int AS activated
        FROM c`)
  ).rows;

  const [time] = (
    await db.execute<{ median: number | null; published: number }>(sql`
      WITH c AS (${users}),
      firsts AS (
        SELECT c.id, min(v.published_at) AS first_publish, c.created_at
          FROM c
          JOIN membership m ON m.user_id = c.id AND m.role = 'owner'
          JOIN workspace w ON w.id = m.workspace_id AND NOT w.demo
          JOIN guide gd ON gd.workspace_id = m.workspace_id
          JOIN guide_version v ON v.guide_id = gd.id AND v.cause = 'publish'
         GROUP BY c.id, c.created_at
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM first_publish - created_at) / 60
             ) AS median,
             count(*)::int AS published
        FROM firsts`)
  ).rows;

  const [resolution] = (
    await db.execute<{ automatic: number; questions: number }>(sql`
      SELECT count(*) FILTER (WHERE t.decision IN ('answered', 'pointer'))::int AS automatic,
             count(*)::int AS questions
        FROM agent_trace t
       WHERE t.conversation_id IS NOT NULL
         AND t.decision <> 'greeting'
         AND t.workspace_id IN (${owned})`)
  ).rows;

  const [attach] = (
    await db.execute<{ with_request: number; opened: number }>(sql`
      SELECT count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM service_request r WHERE r.stay_id = s.id
             ))::int AS with_request,
             count(*)::int AS opened
        FROM stay s
       WHERE s.guide_opened_at IS NOT NULL
         AND s.workspace_id IN (${owned})`)
  ).rows;

  const [retention] = (
    await db.execute<{ retained: number; eligible: number }>(sql`
      WITH c AS (${users})
      SELECT count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM security_event e
                WHERE e.actor_user_id = c.id AND e.type = 'signin.succeeded'
                  AND e.occurred_at >= c.created_at + interval '53 days'
                  AND e.occurred_at < c.created_at + interval '61 days'
             ) OR EXISTS (
               SELECT 1 FROM "session" s
                WHERE s.user_id = c.id
                  AND s.updated_at >= c.created_at + interval '53 days'
                  AND s.updated_at < c.created_at + interval '61 days'
             ))::int AS retained,
             count(*)::int AS eligible
        FROM c
       WHERE c.created_at + interval '60 days' <= ${nowIso}::timestamptz`)
  ).rows;

  const [cost] = (
    await db.execute<{ micros: string | number; stays: number }>(sql`
      SELECT (
               coalesce((SELECT sum(cost_usd_micros) FROM agent_trace
                          WHERE workspace_id IN (${owned})), 0)
             + coalesce((SELECT sum(cost_usd_micros) FROM guide_ai_request
                          WHERE workspace_id IN (${owned})), 0)
             + coalesce((SELECT sum(cost_usd_micros) FROM extraction_request
                          WHERE workspace_id IN (${owned})), 0)
             )::bigint AS micros,
             (SELECT count(*) FROM stay
               WHERE guide_opened_at IS NOT NULL AND workspace_id IN (${owned}))::int AS stays`)
  ).rows;

  const byPlan = (
    await db.execute<{
      plan: string;
      replies: number;
      top_up: number;
      micros: string | number;
    }>(sql`
      SELECT w.plan, coalesce(sum(u.replies), 0)::int AS replies,
             coalesce(sum(u.top_up_replies), 0)::int AS top_up,
             coalesce(sum(u.cost_usd_micros), 0)::bigint AS micros
        FROM chat_usage_daily u
        JOIN workspace w ON w.id = u.workspace_id
       WHERE u.workspace_id IN (${owned})
       GROUP BY w.plan
       ORDER BY w.plan`)
  ).rows;

  const totalUsd = Number(cost?.micros ?? 0) / 1_000_000;
  const staysServed = cost?.stays ?? 0;
  const median = time?.median;
  return {
    cohort: { from: cohort.from, to: cohort.to, signUps: activation?.total ?? 0 },
    activation: {
      ...share(activation?.activated ?? 0, activation?.total ?? 0),
      target: "≥ 50%",
    },
    timeToGuideMinutes: {
      median: median === null || median === undefined ? null : Number(median),
      published: time?.published ?? 0,
      target: "≤ 30 min",
    },
    automatedResolution: {
      ...share(resolution?.automatic ?? 0, resolution?.questions ?? 0),
      target: "≥ 60%",
    },
    attachRate: {
      ...share(attach?.with_request ?? 0, attach?.opened ?? 0),
      target: "≥ 5% requests",
    },
    retentionDay60: {
      ...share(retention?.retained ?? 0, retention?.eligible ?? 0),
      target: "≥ 70%",
    },
    aiCostPerStay: {
      totalUsd,
      staysServed,
      perStayUsd: staysServed === 0 ? null : totalUsd / staysServed,
      target: "measure, then set",
    },
    aiRepliesByPlan: byPlan.map((row) => {
      const replies = Number(row.replies);
      const costUsd = Number(row.micros) / 1_000_000;
      return {
        plan: row.plan,
        replies,
        fromAllowance: replies - Number(row.top_up),
        fromTopUps: Number(row.top_up),
        costUsd,
        costPerReplyUsd: replies === 0 ? null : costUsd / replies,
      };
    }),
  };
}

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const ratio = (s: Share) => `${pct(s.value)} (${s.numerator}/${s.denominator})`;

/** A plain-text table for the terminal. */
export function formatPilotMetrics(metrics: PilotMetrics): string {
  const m = metrics;
  const time = m.timeToGuideMinutes;
  const cost = m.aiCostPerStay;
  const rows: [string, string, string][] = [
    ["Activation (publish + guest open within 7 days)", ratio(m.activation), m.activation.target],
    [
      "Median time to guide",
      time.median === null ? "—" : `${time.median.toFixed(0)} min (${time.published} published)`,
      time.target,
    ],
    ["Automated resolution rate", ratio(m.automatedResolution), m.automatedResolution.target],
    ["Attach rate (stays with a request)", ratio(m.attachRate), m.attachRate.target],
    ["Host retention at day 60", ratio(m.retentionDay60), m.retentionDay60.target],
    [
      "AI cost per stay served",
      cost.perStayUsd === null
        ? "—"
        : `US$${cost.perStayUsd.toFixed(4)} (US$${cost.totalUsd.toFixed(2)} / ${cost.staysServed} stays)`,
      cost.target,
    ],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return [
    `Pilot metrics for sign-ups ${m.cohort.from} to ${m.cohort.to} (${m.cohort.signUps} sign-ups)`,
    "",
    ...rows.map(([label, value, target]) => `${label.padEnd(width)}  ${value}  (target ${target})`),
    "",
    "AI replies by plan (allowance + top-ups; cost per reply):",
    ...(m.aiRepliesByPlan.length === 0
      ? ["  —"]
      : m.aiRepliesByPlan.map(
          (row) =>
            `  ${row.plan}: ${row.replies} replies (${row.fromAllowance} + ${row.fromTopUps}); US$${row.costUsd.toFixed(2)}; ${row.costPerReplyUsd === null ? "—" : `US$${row.costPerReplyUsd.toFixed(4)} per reply`}`,
        )),
  ].join("\n");
}
