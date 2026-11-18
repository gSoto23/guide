import { stayWindow, type StayWindow, type WindowProperty, type WindowStay } from "./window.js";

/**
 * Whether a guest device may see locked values now (feature 004 FR-029, FR-030, research R6).
 * The API always passes its own clock, never the phone's.
 */
export type LockStateName = "public" | "before" | "inside" | "ended";

export interface LockContext {
  link: { status: "active" | "revoked" | "replaced" };
  stay: WindowStay & { status: "active" | "cancelled" | "hidden" };
  property: WindowProperty;
}

export interface LockState {
  state: LockStateName;
  window?: StayWindow;
}

/** Active link, active stay, and the window not closed yet (FR-021). */
export function stayLinkWorking(context: LockContext, now: Date): boolean {
  if (context.link.status !== "active" || context.stay.status !== "active") return false;
  return now.getTime() < stayWindow(context.stay, context.property).closesAt.getTime();
}

export function lockState(context: LockContext | null, now: Date): LockState {
  if (!context) return { state: "public" };
  const window = stayWindow(context.stay, context.property);
  if (!stayLinkWorking(context, now)) return { state: "ended", window };
  if (now.getTime() < window.opensAt.getTime()) return { state: "before", window };
  return { state: "inside", window };
}
