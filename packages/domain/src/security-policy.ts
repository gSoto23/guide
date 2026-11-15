import type { Role } from "./index.js";

/** Owners and admins of workspaces with more than this many properties need MFA (NFR-13). */
export const MFA_PROPERTY_THRESHOLD = 2;

/** Sensitive actions need re-authentication within this window (FR-011, research R5). */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export interface MfaInput {
  isStaff: boolean;
  role: Role | null;
  propertyCount: number;
}

/** FR-009: staff always; owners and admins above the property threshold. */
export function requiresMfa({ isStaff, role, propertyCount }: MfaInput): boolean {
  if (isStaff) {
    return true;
  }
  return (role === "owner" || role === "admin") && propertyCount > MFA_PROPERTY_THRESHOLD;
}

/** True when the session re-authenticated within the last 10 minutes (and not in the future). */
export function isStepUpFresh(strongAuthAt: Date | null, now: Date = new Date()): boolean {
  if (!strongAuthAt) {
    return false;
  }
  const age = now.getTime() - strongAuthAt.getTime();
  return age >= 0 && age <= STEP_UP_WINDOW_MS;
}

export type StepUpMethod = "passkey" | "totp" | "email_otp";

export interface StepUpMethodsInput {
  hasPasskey: boolean;
  totpEnabled: boolean;
  /** True when the action needs a second factor (MFA), not just a recent sign-in. */
  needSecondFactor: boolean;
}

/** Methods the client can use to satisfy step_up_required (contracts/http-api.md). */
export function stepUpMethods({
  hasPasskey,
  totpEnabled,
  needSecondFactor,
}: StepUpMethodsInput): StepUpMethod[] {
  const methods: StepUpMethod[] = [];
  if (hasPasskey) methods.push("passkey");
  if (totpEnabled) methods.push("totp");
  if (!needSecondFactor) methods.push("email_otp");
  return methods;
}
