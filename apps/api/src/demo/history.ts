import { createHash } from "node:crypto";
import { DEMO_EXPERIENCE_REFS, DEMO_QUESTIONS, type DemoLanguage } from "./content.js";

/**
 * The demo's 60 days of history (feature 014 FR-025, research R14): a deterministic plan for each
 * property, so the same workspace ID and day give the same history. Busier on weekends, quieter
 * mid-week, with day-to-day variation so Analytics shows trends.
 */
export const HISTORY_DAYS = 60;

export interface PlannedQuestion {
  /** Index in DEMO_QUESTIONS. */
  scenario: number;
  language: DemoLanguage;
  /** Local hour of the day (8 to 21). */
  hour: number;
}

export interface PlannedClick {
  partner: "viator" | "civitatis";
  ref: string;
  clicks: number;
}

export interface PlannedDay {
  /** Days before the run day: 0 is today, 59 is the oldest. */
  daysAgo: number;
  propertyOpens: number;
  stayOpens: number;
  exploreOpens: number;
  clicks: PlannedClick[];
  questions: PlannedQuestion[];
}

export interface PlannedStay {
  /** Check-in, in days before the run day. */
  checkInDaysAgo: number;
  nights: number;
  guestName: string;
  guestCount: number;
  openedGuide: boolean;
  /** Requests made during the stay, by extra index and final status (the builder adds a waiting one). */
  requests: { extra: number; status: "confirmed" | "declined" }[];
}

export interface PropertyHistory {
  days: PlannedDay[];
  pastStays: PlannedStay[];
}

/** mulberry32: small, fast, and deterministic. */
function generator(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted(random: () => number): number {
  const total = DEMO_QUESTIONS.reduce((sum, question) => sum + question.weight, 0);
  let pick = random() * total;
  for (let index = 0; index < DEMO_QUESTIONS.length; index += 1) {
    pick -= DEMO_QUESTIONS[index]!.weight;
    if (pick <= 0) return index;
  }
  return 0;
}

/** Fridays to Sundays are busier (the run day's weekday counts back from `today`). */
function isWeekend(today: Date, daysAgo: number): boolean {
  const day = new Date(today.getTime() - daysAgo * 86_400_000).getUTCDay();
  return day === 0 || day === 5 || day === 6;
}

export function planHistory(input: {
  seed: string;
  today: Date;
  questionsPerDay: number;
  guestNames: readonly string[];
  extras: number;
  maxGuests: number;
}): PropertyHistory {
  const random = generator(input.seed);
  const days: PlannedDay[] = [];
  for (let daysAgo = HISTORY_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const busy = isWeekend(input.today, daysAgo) ? 1.5 : 1;
    // A gentle upward trend, so the last 30 days beat the previous 30.
    const trend = 0.75 + 0.5 * ((HISTORY_DAYS - daysAgo) / HISTORY_DAYS);
    const count = Math.max(0, Math.round(input.questionsPerDay * busy * trend * (0.5 + random())));
    const questions: PlannedQuestion[] = Array.from({ length: count }, () => ({
      scenario: weighted(random),
      language: random() < 0.6 ? "en" : "es",
      hour: 8 + Math.floor(random() * 14),
    }));
    const clicks: PlannedClick[] = DEMO_EXPERIENCE_REFS.flatMap((entry) => {
      const value = Math.floor(random() * 3 * busy * trend);
      return value > 0 ? [{ partner: entry.partner, ref: entry.ref, clicks: value }] : [];
    });
    days.push({
      daysAgo,
      propertyOpens: Math.round((2 + random() * 4) * busy * trend),
      stayOpens: Math.round((3 + random() * 5) * busy * trend),
      exploreOpens: Math.round((1 + random() * 3) * busy * trend),
      clicks,
      questions,
    });
  }

  // About one stay a week, back to back with gaps; the run's own past, current, and upcoming stays
  // are added by the builder.
  const pastStays: PlannedStay[] = [];
  let checkIn = HISTORY_DAYS - 2;
  let name = 0;
  while (checkIn > 6) {
    const nights = 2 + Math.floor(random() * 4);
    const openedGuide = random() < 0.85;
    const requests: PlannedStay["requests"] = [];
    if (openedGuide && random() < 0.5) {
      requests.push({
        extra: Math.floor(random() * input.extras),
        status: random() < 0.7 ? "confirmed" : "declined",
      });
    }
    pastStays.push({
      checkInDaysAgo: checkIn,
      nights,
      guestName: input.guestNames[name % input.guestNames.length]!,
      guestCount: 1 + Math.floor(random() * input.maxGuests),
      openedGuide,
      requests,
    });
    name += 1;
    checkIn -= nights + 1 + Math.floor(random() * 3);
  }
  return { days, pastStays };
}

/** Assistant replies counted toward the plan for a day's questions (answers and drafts). */
export function aiReplies(questions: readonly PlannedQuestion[]): number {
  return questions.filter((question) => DEMO_QUESTIONS[question.scenario]!.decision !== "held")
    .length;
}
