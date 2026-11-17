import { feedReadRequestSchema, type FeedReadRequest, type FeedReadResponse } from "../protocol.js";
import { parseFeed } from "./parse.js";
import { safeFetch, type Resolver, type Send } from "./safe-fetch.js";

export interface FeedReaderDeps {
  resolve?: Resolver;
  send?: Send;
  /** Development and test only: the iCal fixture server's host (research R2). */
  testAllowHost?: string;
  now?: () => Date;
}

/**
 * Reads one calendar link (research R2, R8, FR-021, FR-026). The UTC date one day back is the
 * cut-off for past entries here; the worker applies the property's own time zone afterwards.
 */
export function createFeedReader(deps: FeedReaderDeps = {}) {
  return async (input: FeedReadRequest): Promise<FeedReadResponse> => {
    const parsed = feedReadRequestSchema.safeParse(input);
    if (!parsed.success) return { error: "not_https" };
    const request = parsed.data;
    const result = await safeFetch(request.url, {
      etag: request.etag,
      lastModified: request.lastModified,
      resolve: deps.resolve,
      send: deps.send,
      testAllowHost: deps.testAllowHost,
    });
    if ("error" in result) return { error: result.error };
    if ("notModified" in result) {
      return { notModified: true, etag: result.etag, lastModified: result.lastModified };
    }
    const now = deps.now?.() ?? new Date();
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const entries = parseFeed(result.body, yesterday);
    if (!entries) return { error: "not_ical" };
    return { entries, etag: result.etag, lastModified: result.lastModified };
  };
}
