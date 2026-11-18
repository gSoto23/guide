"use client";

import type { ShareStay } from "@guidesk/contracts";

/** Upcoming stays with their stay links (feature 004 US2); filled in by the US2 tasks. */
export function StaysCard(_props: {
  locale: string;
  propertyId: string;
  stays: ShareStay[];
  requireConfirmationCode: boolean;
  onChange: () => Promise<void>;
}) {
  return null;
}
