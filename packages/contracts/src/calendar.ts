import { z } from "zod";
import type { MemberServiceRequest } from "./extras.js";
import type { ShareStay } from "./share.js";

/**
 * Feature 018 (contracts/http-api.md): the stay calendar and the stay view. Read-only: Guidesk
 * shows the stays it knows and never changes availability or bookings on any platform.
 */

/** The longest range one calendar read covers, in days (research R1). */
export const CALENDAR_MAX_DAYS = 62;

export const calendarQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    propertyId: z.uuid().optional(),
    channel: z.string().trim().min(1).max(40).optional(),
    cancelled: z.enum(["true", "false"]).optional(),
  })
  .strict();
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export interface CalendarProperty {
  id: string;
  name: string;
  timeZone: string | null;
}

export interface CalendarStay {
  id: string;
  propertyId: string;
  checkInDate: string;
  checkoutDate: string;
  /** The stay's own times when set, otherwise the property's. */
  checkInTime: string | null;
  checkoutTime: string | null;
  source: "ical" | "pms" | "manual";
  channel: string;
  status: "active" | "cancelled";
  mayBeBlock: boolean;
  overlaps: boolean;
  guestName: string | null;
  guestCount: number | null;
  bookingReference: string | null;
  marks: {
    linkOpened: boolean;
    openEscalation: boolean;
    waitingRequests: number;
    confirmedExtras: number;
  };
}

export interface CalendarResponse {
  properties: CalendarProperty[];
  stays: CalendarStay[];
}

export interface StayConversation {
  id: string;
  status: string;
  reason: string | null;
  lastMessageAt: string | null;
}

export interface StayTotal {
  currency: string;
  /** Confirmed add-ons: price × quantity. */
  confirmed: number;
  /** Paid through Guidesk checkout, minus refunds. */
  paid: number;
}

/** `GET stays/{stayId}` (FR-008 to FR-014). */
export interface StayOverview {
  stay: CalendarStay & {
    guestNameRemoved: boolean;
    guestDetails: {
      source: "feed" | "pms" | "host" | null;
      setAt: string | null;
      setBy: string | null;
    };
  };
  property: CalendarProperty;
  link: ShareStay["link"];
  conversations: StayConversation[];
  requests: MemberServiceRequest[];
  totals: StayTotal[];
  /** Owners and admins: may edit guest details and copy links on the Share screen. */
  canManage: boolean;
}
