import { z } from "zod";
import { pmsProviderSchema } from "./properties.js";

/**
 * Contracts for PMS connections (feature 002 FR-027 to FR-036, data model §4, research R7). The
 * credential goes in once, on connect, and never comes back in any response (AC-SEC-008).
 */
export const createPmsConnectionSchema = z
  .object({
    provider: pmsProviderSchema,
    /** The provider's own value: a Beds24 invite code or a Hostex access token. */
    credential: z.string().trim().min(8).max(4000),
  })
  .strict();
export type CreatePmsConnectionBody = z.infer<typeof createPmsConnectionSchema>;

export const pmsConnectionStatusSchema = z.enum(["active", "failing", "disconnected"]);

export const pmsConnectionSchema = z.object({
  id: z.uuid(),
  provider: pmsProviderSchema,
  accountLabel: z.string(),
  status: pmsConnectionStatusSchema,
  lastRefreshAt: z.iso.datetime().nullable(),
  failingSince: z.iso.datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  connectedAt: z.iso.datetime(),
});
export type PmsConnection = z.infer<typeof pmsConnectionSchema>;

export const pmsConnectionListSchema = z.object({ items: z.array(pmsConnectionSchema) });
export type PmsConnectionList = z.infer<typeof pmsConnectionListSchema>;

/** A PMS listing as offered for import, marked when this workspace already has it (FR-033). */
export const pmsListingSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  alreadyImported: z.boolean(),
  propertyId: z.uuid().nullable(),
});
export type PmsListingOption = z.infer<typeof pmsListingSchema>;

export const pmsListingListSchema = z.object({ items: z.array(pmsListingSchema) });
export type PmsListingList = z.infer<typeof pmsListingListSchema>;

export const createdPmsConnectionSchema = pmsConnectionSchema.extend({
  listings: z.array(pmsListingSchema),
});
export type CreatedPmsConnection = z.infer<typeof createdPmsConnectionSchema>;

export const startPmsImportSchema = z
  .object({ externalIds: z.array(z.string().trim().min(1).max(120)).min(1).max(500) })
  .strict();
export type StartPmsImportBody = z.infer<typeof startPmsImportSchema>;

/** DELETE …/pms-connections/{id}: whether the provider revoked the token too (FR-036). */
export const pmsDisconnectResultSchema = z.object({
  providerRevoked: z.boolean(),
  /** Where the host deletes the token at the provider, when Guidesk could not. */
  instructionsUrl: z.string().nullable(),
});
export type PmsDisconnectResult = z.infer<typeof pmsDisconnectResultSchema>;
