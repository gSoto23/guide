import type { PmsListingSummary } from "@guidesk/integrations";
import { loadConnection, type PmsJobDeps } from "./pms-common.js";

/**
 * The API's calls into the worker (T096, research R5): listing a connection's PMS listings
 * again, and revoking Beds24's token at disconnect. The job's return value is the answer the API
 * waits for; it never carries the credential.
 */
interface ConnectionJob {
  connectionId: string;
  workspaceId: string;
}

function parse(data: unknown): ConnectionJob | null {
  const job = data as Partial<ConnectionJob>;
  return typeof job.connectionId === "string" && typeof job.workspaceId === "string"
    ? { connectionId: job.connectionId, workspaceId: job.workspaceId }
    : null;
}

/**
 * `pms.listings`: names only, for choosing what to import (FR-033). The answer is an object,
 * because pg-boss wraps any other output in `{value}`.
 */
export function createPmsListingsHandler(deps: PmsJobDeps) {
  return async ([job]: { id: string; data: unknown }[]): Promise<{
    listings: PmsListingSummary[];
  }> => {
    const payload = parse(job?.data);
    if (!payload) throw new Error("invalid pms.listings job");
    const connection = await loadConnection(deps, payload.workspaceId, payload.connectionId);
    if (!connection?.credential) throw new Error("connection has no credential");
    const listings = await deps.adapters[connection.provider].listListings(connection.credential);
    return {
      listings: listings.map((listing) => ({ externalId: listing.externalId, name: listing.name })),
    };
  };
}

/** `pms.revoke`: asks the provider to revoke the token; never fails the disconnect (FR-036). */
export function createPmsRevokeHandler(deps: PmsJobDeps) {
  return async ([job]: { id: string; data: unknown }[]): Promise<{ providerRevoked: boolean }> => {
    const payload = parse(job?.data);
    if (!payload) return { providerRevoked: false };
    const connection = await loadConnection(deps, payload.workspaceId, payload.connectionId);
    if (!connection?.credential) return { providerRevoked: false };
    try {
      return await deps.adapters[connection.provider].revoke(connection.credential);
    } catch {
      return { providerRevoked: false };
    }
  };
}
