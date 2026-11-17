import { Beds24Adapter } from "./beds24/adapter.js";
import { createFixtureFetch } from "./fixtures.js";
import { HostexAdapter } from "./hostex/adapter.js";
import type { PmsPort, PmsProvider } from "./port.js";

export interface PmsAdapterOptions {
  mode: "live" | "fixtures";
  /** Replaces the network, for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** One adapter per provider; the same instances keep Beds24's access-token cache in memory. */
export function createPmsAdapters(options: PmsAdapterOptions): Record<PmsProvider, PmsPort> {
  const fetchImpl =
    options.fetch ?? (options.mode === "fixtures" ? createFixtureFetch() : globalThis.fetch);
  const shared = { fetch: fetchImpl, ...(options.sleep ? { sleep: options.sleep } : {}) };
  return { beds24: new Beds24Adapter(shared), hostex: new HostexAdapter(shared) };
}
