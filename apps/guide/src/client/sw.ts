import { guideOf, markOffline, storable, storableMedia, strategyFor } from "./sw-rules.js";

/**
 * The guest guide's service worker (feature 004 US5, research R9): pages already viewed and their
 * images stay readable offline; personal responses and locked values are never stored (SEC-04).
 */
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface WorkerScope {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const VERSION = "v1";
const PAGES = `guidesk-pages-${VERSION}`;
const STATIC = `guidesk-static-${VERSION}`;
const MEDIA = `guidesk-media-${VERSION}`;
const SAVED_AT = "x-guidesk-saved-at";
const PAGE_TIMEOUT_MS = 4000;

scope.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((cache) => cache.add("/offline")));
  void scope.skipWaiting();
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![PAGES, STATIC, MEDIA].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => scope.clients.claim()),
  );
});

async function forget(publicId: string): Promise<void> {
  for (const name of [PAGES, MEDIA]) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (guideOf(new URL(request.url).pathname) === publicId) await cache.delete(request);
    }
  }
}

async function offlineFallback(): Promise<Response> {
  return (await caches.match("/offline")) ?? new Response("Offline", { status: 503 });
}

async function page(request: Request): Promise<Response> {
  const cache = await caches.open(PAGES);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), PAGE_TIMEOUT_MS),
      ),
    ]);
    if (storable(response.status, response.type, response.headers.get("cache-control"))) {
      const headers = new Headers(response.headers);
      headers.set(SAVED_AT, new Date().toISOString());
      await cache.put(
        request,
        new Response(await response.clone().blob(), { status: 200, headers }),
      );
    } else if (response.status === 404) {
      const publicId = guideOf(new URL(request.url).pathname);
      if (publicId) await forget(publicId);
    }
    return response;
  } catch {
    const saved = await cache.match(request);
    if (!saved) return offlineFallback();
    const html = markOffline(
      await saved.text(),
      saved.headers.get(SAVED_AT) ?? new Date().toISOString(),
    );
    return new Response(html, { status: 200, headers: saved.headers });
  }
}

async function cacheFirst(name: string, request: Request, media: boolean): Promise<Response> {
  const cache = await caches.open(name);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  const keep = media ? storableMedia(response.status, response.type) : response.status === 200;
  if (keep) await cache.put(request, response.clone());
  return response;
}

scope.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const strategy = strategyFor(url, request.mode, request.method, scope.location.origin);
  switch (strategy) {
    case "page":
      event.respondWith(page(request));
      return;
    case "static":
      event.respondWith(cacheFirst(STATIC, request, false));
      return;
    case "media":
      event.respondWith(cacheFirst(MEDIA, request, true));
      return;
    case "navigate-other":
      event.respondWith(fetch(request).catch(offlineFallback));
      return;
    default:
      return;
  }
});
