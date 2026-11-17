import { z } from "zod";
import { timeOfDaySchema } from "./properties.js";

/** Contracts for stays (feature 002 FR-022, FR-030, FR-052 to FR-054, data model §3). */
export const staySchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  source: z.enum(["ical", "pms", "manual"]),
  channel: z.string(),
  checkInDate: z.iso.date(),
  checkoutDate: z.iso.date(),
  /** The stay's own times for manual stays; otherwise null, and the property's times apply. */
  checkInTime: z.string().nullable(),
  checkoutTime: z.string().nullable(),
  status: z.enum(["active", "cancelled", "hidden"]),
  mayBeBlock: z.boolean(),
  /** Overlaps another visible stay of the property (FR-054). */
  overlaps: z.boolean(),
  /** The feed or PMS connection behind it is failing (FR-024). */
  possiblyOutdated: z.boolean(),
  guestCount: z.number().int().nullable(),
  guestName: z.string().nullable(),
  guestNameRemoved: z.boolean(),
  bookingReference: z.string().nullable(),
});
export type Stay = z.infer<typeof staySchema>;

export const stayListSchema = z.object({ items: z.array(staySchema) });
export type StayList = z.infer<typeof stayListSchema>;

export const listStaysQuerySchema = z
  .object({
    /** `YYYY-MM-DD`; by default today in the property's time zone. */
    from: z.iso.date().optional(),
    status: z.enum(["active", "hidden", "cancelled", "all"]).default("active"),
  })
  .strict();
export type ListStaysQuery = z.infer<typeof listStaysQuerySchema>;

const manualStayFields = {
  checkInDate: z.iso.date(),
  checkoutDate: z.iso.date(),
  guestCount: z.number().int().min(1).max(50).nullable().optional(),
  guestName: z.string().trim().min(1).max(120).nullable().optional(),
  channel: z.string().trim().min(1).max(40).optional(),
  checkInTime: timeOfDaySchema.nullable().optional(),
  checkoutTime: timeOfDaySchema.nullable().optional(),
};

export const createStaySchema = z
  .object(manualStayFields)
  .strict()
  .refine((body) => body.checkoutDate > body.checkInDate, {
    message: "Checkout must be after check-in",
    path: ["checkoutDate"],
  });
export type CreateStayBody = z.infer<typeof createStaySchema>;

/** Manual stays: any field. Feed and PMS stays: only `{status: "hidden"}` (FR-053). */
export const updateStaySchema = z
  .object({ ...manualStayFields, status: z.literal("hidden") })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Change at least one field");
export type UpdateStayBody = z.infer<typeof updateStaySchema>;
