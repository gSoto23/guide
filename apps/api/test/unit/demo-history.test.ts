import { describe, expect, it } from "vitest";
import { DEMO_GUEST_NAMES, DEMO_PROPERTIES, DEMO_QUESTIONS } from "../../src/demo/content.js";
import { aiReplies, HISTORY_DAYS, planHistory } from "../../src/demo/history.js";

/** Feature 014 T023: the demo's 60 days of history. */
const today = new Date("2026-11-19T12:00:00Z");

function plan(seed = "workspace-1", questionsPerDay = 4) {
  return planHistory({
    seed,
    today,
    questionsPerDay,
    guestNames: DEMO_GUEST_NAMES,
    extras: 3,
    maxGuests: 6,
  });
}

describe("demo history", () => {
  it("is the same for the same seed and day, and different for another seed", () => {
    expect(plan()).toEqual(plan());
    expect(plan("workspace-2")).not.toEqual(plan());
  });

  it("covers 60 days, oldest first, with variation", () => {
    const { days } = plan();
    expect(days).toHaveLength(HISTORY_DAYS);
    expect(days[0]?.daysAgo).toBe(59);
    expect(days.at(-1)?.daysAgo).toBe(0);
    expect(new Set(days.map((day) => day.questions.length)).size).toBeGreaterThan(3);
    expect(new Set(days.map((day) => day.stayOpens)).size).toBeGreaterThan(3);
  });

  it("grows a little, so the last 30 days beat the previous 30", () => {
    const { days } = plan();
    const opens = (from: number, to: number) =>
      days
        .filter((day) => day.daysAgo >= from && day.daysAgo < to)
        .reduce((sum, day) => sum + day.propertyOpens + day.stayOpens, 0);
    expect(opens(0, 30)).toBeGreaterThan(opens(30, 60));
  });

  it("keeps a month of AI replies under the Pro pool for two properties", () => {
    const month = (seed: string, perDay: number) =>
      plan(seed, perDay)
        .days.filter((day) => day.daysAgo < 30)
        .reduce((sum, day) => sum + aiReplies(day.questions), 0);
    const workspace =
      month("w:brisa", DEMO_PROPERTIES[0]!.questionsPerDay) +
      month("w:loft", DEMO_PROPERTIES[1]!.questionsPerDay);
    expect(workspace).toBeGreaterThan(60);
    expect(workspace).toBeLessThan(600);
  });

  it("includes several escalation reasons and unanswered questions", () => {
    const reasons = new Set(
      plan()
        .days.flatMap((day) => day.questions)
        .map((question) => DEMO_QUESTIONS[question.scenario]!)
        .filter((question) => question.decision === "held")
        .map((question) => question.reason),
    );
    expect(reasons).toContain("not_confident");
    expect(reasons.size).toBeGreaterThanOrEqual(4);
  });

  it("plans past stays with fictional first names and answered requests", () => {
    const stays = [...plan().pastStays, ...plan("other").pastStays];
    expect(stays.length).toBeGreaterThan(8);
    for (const stay of stays) expect(DEMO_GUEST_NAMES).toContain(stay.guestName);
    const statuses = new Set(stays.flatMap((stay) => stay.requests.map((r) => r.status)));
    expect(statuses).toEqual(new Set(["confirmed", "declined"]));
  });

  it("always has a confirmed request in the last 30 days, whatever the seed", () => {
    for (let index = 0; index < 200; index += 1) {
      const stays = plan(`seed-${index}`).pastStays;
      const recent = stays.filter((stay) => stay.checkInDaysAgo < 30);
      expect(recent.some((stay) => stay.requests.some((r) => r.status === "confirmed"))).toBe(true);
    }
  });

  it("always has a declined request, whatever the seed", () => {
    for (let index = 0; index < 200; index += 1) {
      const stays = plan(`seed-${index}`).pastStays;
      expect(stays.some((stay) => stay.requests.some((r) => r.status === "declined"))).toBe(true);
    }
  });
});
