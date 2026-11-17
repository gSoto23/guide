import { createBeds24FixtureServer } from "./beds24/fixture-server.js";
import { createHostexFixtureServer } from "./hostex/fixture-server.js";

/**
 * `PMS_MODE=fixtures` (T092): a `fetch` that answers Beds24 and Hostex requests from the synthetic
 * fixtures, so the real adapters run end to end in development and end-to-end tests without a
 * provider account. Any other host is refused: fixture mode never reaches the network. Refused in
 * production (settings).
 */
export function createFixtureFetch(options: { now?: () => number } = {}): typeof fetch {
  const beds24 = createBeds24FixtureServer(options);
  const hostex = createHostexFixtureServer(options);
  return async (input, init) => {
    const request = new Request(input, init);
    const host = new URL(request.url).hostname;
    if (host === "beds24.com") return beds24.handle(request);
    if (host === "api.hostex.io") return hostex.handle(request);
    throw new TypeError(`fixture mode has no answer for ${host}`);
  };
}
