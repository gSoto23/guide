import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";

/**
 * Outbound fetch for host-supplied calendar links (FR-026, research R2, SEC-09, AC-SEC-002).
 *
 * - HTTPS only.
 * - The host name is resolved first, and every address must be public unicast: private,
 *   loopback, link-local (169.254.0.0/16 holds the metadata endpoints), carrier-grade NAT,
 *   multicast, unique-local, and IPv4-mapped forms of those are refused.
 * - The connection is pinned to the address that was checked, so DNS rebinding cannot swap it.
 * - Redirects are followed by hand, at most 3, and every hop is checked again.
 * - The body stops at 2 MB, and the whole read at 10 seconds.
 */
export const FEED_MAX_BYTES = 2 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_REDIRECTS = 3;

export type FetchError =
  | "not_https"
  | "blocked_address"
  | "dns_failed"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "connection_failed"
  | `http_${number}`;

export type SafeFetchResult =
  | { ok: true; body: Buffer; etag: string | null; lastModified: string | null }
  | { notModified: true; etag: string | null; lastModified: string | null }
  | { error: FetchError };

export type Resolver = (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>;

/** One HTTP exchange with a connection pinned to `address`; injectable for tests. */
export interface HopRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface HopResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array> & { destroy?: () => void };
}

export type Send = (hop: HopRequest) => Promise<HopResponse>;

export interface SafeFetchOptions {
  etag?: string | undefined;
  lastModified?: string | undefined;
  resolve?: Resolver;
  send?: Send;
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * Development and test only (research R2): this one host may resolve to a private address,
   * so the local iCal fixture server can be read. The handler never passes it in production.
   */
  testAllowHost?: string | undefined;
}

const systemResolver: Resolver = async (hostname) => {
  const addresses: LookupAddress[] = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
};

/** True only for public unicast addresses. Anything else is a route to something internal. */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
}

function header(headers: HopResponse["headers"], name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** The default hop: undici with a connection pinned to the checked address. */
function pinnedSend(ca: string | undefined): Send {
  return async (hop) => {
    const agent = new Agent({
      connect: {
        ...(ca ? { ca } : {}),
        // Answer the connection's DNS lookup with the address that was already checked.
        lookup: (_hostname, options, callback) => {
          if ((options as { all?: boolean }).all) {
            (callback as (error: null, addresses: LookupAddress[]) => void)(null, [
              { address: hop.address, family: hop.family },
            ]);
          } else {
            (callback as (error: null, address: string, family: number) => void)(
              null,
              hop.address,
              hop.family,
            );
          }
        },
      },
    });
    try {
      const response = await request(hop.url, {
        method: "GET",
        dispatcher: agent,
        headers: hop.headers,
        signal: hop.signal,
      });
      const stream = response.body;
      return {
        status: response.statusCode,
        headers: response.headers,
        body: {
          [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
          // Ends the exchange: drops any unread body and closes the pinned connection.
          destroy: () => {
            // Destroying an unread body emits an abort error; it is expected here, not a failure.
            stream.on("error", () => undefined);
            stream.destroy();
            void agent.close().catch(() => undefined);
          },
        },
      };
    } catch (error) {
      void agent.close().catch(() => undefined);
      throw error;
    }
  };
}

async function readLimited(
  body: HopResponse["body"],
  maxBytes: number,
): Promise<Buffer | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      body.destroy?.();
      return "too_large";
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Reads one calendar link under the rules above. Never throws for network outcomes. */
export async function safeFetch(
  link: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const resolve = options.resolve ?? systemResolver;
  const send = options.send ?? pinnedSend(undefined);
  const maxBytes = options.maxBytes ?? FEED_MAX_BYTES;
  const signal = AbortSignal.timeout(options.timeoutMs ?? FEED_TIMEOUT_MS);
  const headers: Record<string, string> = {
    accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
    "user-agent": "Guidesk-Calendar/1.0",
  };
  if (options.etag) headers["if-none-match"] = options.etag;
  if (options.lastModified) headers["if-modified-since"] = options.lastModified;

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { error: "not_https" };
  }

  try {
    for (let redirects = 0; ; redirects += 1) {
      if (url.protocol !== "https:") return { error: "not_https" };
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: { address: string; family: 4 | 6 }[];
      if (ipaddr.isValid(hostname)) {
        addresses = [
          { address: hostname, family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4 },
        ];
      } else {
        try {
          addresses = await resolve(hostname);
        } catch {
          return { error: "dns_failed" };
        }
      }
      if (addresses.length === 0) return { error: "dns_failed" };
      const allowedPrivately =
        options.testAllowHost !== undefined && hostname === options.testAllowHost;
      if (!allowedPrivately && addresses.some((entry) => !isPublicAddress(entry.address))) {
        return { error: "blocked_address" };
      }
      // Every address passed the check; IPv4 first, because many hosts listen only there.
      const target = addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
      const response = await send({
        url,
        address: target.address,
        family: target.family,
        headers,
        signal,
      });
      const etag = header(response.headers, "etag");
      const lastModified = header(response.headers, "last-modified");

      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        response.body.destroy?.();
        const location = header(response.headers, "location");
        if (!location) return { error: `http_${response.status}` };
        if (redirects >= FEED_MAX_REDIRECTS) return { error: "too_many_redirects" };
        url = new URL(location, url);
        continue;
      }
      if (response.status === 304) {
        response.body.destroy?.();
        return { notModified: true, etag, lastModified };
      }
      if (response.status < 200 || response.status >= 300) {
        response.body.destroy?.();
        return { error: `http_${response.status}` };
      }
      const declared = Number(header(response.headers, "content-length") ?? "0");
      if (declared > maxBytes) {
        response.body.destroy?.();
        return { error: "too_large" };
      }
      const body = await readLimited(response.body, maxBytes);
      response.body.destroy?.();
      if (body === "too_large") return { error: "too_large" };
      return { ok: true, body, etag, lastModified };
    }
  } catch {
    return { error: signal.aborted ? "timeout" : "connection_failed" };
  }
}

/** The default hop for the given test certificate authority (development and test only). */
export function createPinnedSend(ca?: string): Send {
  return pinnedSend(ca);
}
