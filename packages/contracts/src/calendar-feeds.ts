import { z } from "zod";

/** Contracts for calendar feeds (feature 002 FR-020 to FR-026, data model §3). */
export const feedChannelSchema = z.enum(["airbnb", "booking", "vrbo", "other"]);
export type FeedChannel = z.infer<typeof feedChannelSchema>;

const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an https:// link");

const channelLabelSchema = z.string().trim().min(1).max(40);

export const createCalendarFeedSchema = z
  .object({
    url: httpsUrlSchema,
    channel: feedChannelSchema.optional(),
    channelLabel: channelLabelSchema.optional(),
  })
  .strict();
export type CreateCalendarFeedBody = z.infer<typeof createCalendarFeedSchema>;

export const updateCalendarFeedSchema = z
  .object({ channelLabel: channelLabelSchema.optional(), url: httpsUrlSchema.optional() })
  .strict()
  .refine(
    (body) => body.channelLabel !== undefined || body.url !== undefined,
    "Change the label or the link",
  );
export type UpdateCalendarFeedBody = z.infer<typeof updateCalendarFeedSchema>;

/** A feed as owners and admins see it: never the link, only its masked hint (FR-025). */
export const calendarFeedSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  channel: feedChannelSchema,
  channelLabel: z.string().nullable(),
  displayHint: z.string(),
  status: z.enum(["active", "failing"]),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastAttemptAt: z.iso.datetime().nullable(),
  failingSince: z.iso.datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;

export const calendarFeedListSchema = z.object({ items: z.array(calendarFeedSchema) });
export type CalendarFeedList = z.infer<typeof calendarFeedListSchema>;

export const stayPreviewSchema = z.object({
  checkInDate: z.iso.date(),
  checkoutDate: z.iso.date(),
  mayBeBlock: z.boolean(),
});

/** The saved feed with the upcoming stays it found (FR-021). */
export const createdCalendarFeedSchema = calendarFeedSchema.extend({
  upcomingStays: z.array(stayPreviewSchema),
});
export type CreatedCalendarFeed = z.infer<typeof createdCalendarFeedSchema>;
