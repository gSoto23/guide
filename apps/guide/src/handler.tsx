import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { fetchGuide } from "./api-client.js";
import type { Assets } from "./assets.js";
import type { PageChrome } from "./components/layout.js";
import type { GuideConfig } from "./config.js";
import { CACHE, securityHeaders } from "./headers.js";
import { isGuestLocale, preferredLocale, translator, type GuestLocale } from "./i18n.js";
import { EmergencyPage, HomePage, SectionPage } from "./pages/guide-pages.js";
import {
  ExchangePage,
  OfflinePage,
  RateLimitedPage,
  RootPage,
  UnavailablePage,
} from "./pages/simple-pages.js";

/**
 * The guest app (feature 004 contracts/guide-web.md): a web-standard Request → Response handler
 * shared by the local Node server and the Lambda adapter. Pages are server-rendered React with
 * no hydration (research R3).
 */
export const LANGUAGE_COOKIE = "guidesk_lang";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

export interface HandlerDeps {
  config: GuideConfig;
  assets: Assets;
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function createHandler({ config, assets }: HandlerDeps) {
  const security = securityHeaders(config);

  const respond = (
    body: BodyInit | null,
    status: number,
    headers: Record<string, string>,
  ): Response => new Response(body, { status, headers: { ...security, ...headers } });

  const html = (element: ReactElement, status: number, cache: string): Response =>
    respond(`<!doctype html>${renderToString(element)}`, status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cache,
    });

  const chrome = (locale: GuestLocale): PageChrome => ({ t: translator(locale), locale, assets });

  const requestLocale = (request: Request): GuestLocale => {
    const cookie = readCookie(request.headers.get("cookie"), LANGUAGE_COOKIE);
    if (isGuestLocale(cookie)) return cookie;
    return preferredLocale(request.headers.get("accept-language")) ?? "es";
  };

  const unavailable = (locale: GuestLocale) =>
    html(<UnavailablePage {...chrome(locale)} />, 404, CACHE.unavailable);

  async function staticFile(relative: string, cache: string): Promise<Response> {
    const path = normalize(join(assets.publicDir, relative));
    if (!path.startsWith(normalize(assets.publicDir))) return respond(null, 404, {});
    try {
      const body = await readFile(path);
      return respond(body, 200, {
        "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        "cache-control": cache,
      });
    } catch {
      return respond("Not found", 404, {
        "content-type": "text/plain",
        "cache-control": CACHE.noStore,
      });
    }
  }

  function manifest(locale: GuestLocale): Response {
    const t = translator(locale);
    return respond(
      JSON.stringify({
        name: t("root.title"),
        short_name: "Guidesk",
        start_url: "/",
        display: "standalone",
        background_color: "#FFFCF8",
        theme_color: "#FFFCF8",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      }),
      200,
      { "content-type": "application/manifest+json", "cache-control": CACHE.day },
    );
  }

  async function guidePage(
    request: Request,
    publicId: string,
    lang: string,
    rest: string | undefined,
  ): Promise<Response> {
    if (!isGuestLocale(lang)) return unavailable(requestLocale(request));
    const result = await fetchGuide(
      config,
      publicId,
      lang,
      request.headers.get("x-forwarded-for") ?? undefined,
    );
    if (result.kind === "unavailable") return unavailable(lang);
    if (result.kind === "rate_limited") {
      return html(<RateLimitedPage {...chrome(lang)} />, 429, CACHE.noStore);
    }
    if (result.kind === "error") {
      return html(<RateLimitedPage {...chrome(lang)} />, 503, CACHE.noStore);
    }
    const guide = result.guide;
    if (guide.language !== lang) {
      // A language the guide does not publish: its primary language (FR-013).
      return respond(null, 302, {
        location: `/g/${publicId}/${guide.language}${rest ? `/${rest}` : ""}`,
        "cache-control": CACHE.guide,
      });
    }
    const input = { ...chrome(lang), guide };
    if (!rest) return html(<HomePage {...input} />, 200, CACHE.guide);
    if (rest === "emergency") return html(<EmergencyPage {...input} />, 200, CACHE.guide);
    if (UUID.test(rest) && guide.sections.some((section) => section.id === rest)) {
      return html(<SectionPage {...input} sectionId={rest} />, 200, CACHE.guide);
    }
    return unavailable(lang);
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return respond(null, 405, { allow: "GET, HEAD", "cache-control": CACHE.noStore });
    }
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean);
    if (path === "/")
      return html(<RootPage {...chrome(requestLocale(request))} />, 200, CACHE.hour);
    if (path === "/offline") {
      return html(<OfflinePage {...chrome(requestLocale(request))} />, 200, CACHE.day);
    }
    if (path === "/manifest.webmanifest") return manifest(requestLocale(request));
    if (path === "/sw.js") return staticFile("sw.js", CACHE.revalidate);
    if (parts[0] === "assets" && parts.length === 2) {
      return staticFile(`assets/${parts[1]}`, CACHE.immutable);
    }
    if (parts[0] === "icons" && parts.length === 2)
      return staticFile(`icons/${parts[1]}`, CACHE.day);
    if (parts[0] === "s" && parts.length === 2) {
      return html(<ExchangePage {...chrome(requestLocale(request))} />, 200, CACHE.noStore);
    }
    if (parts[0] === "g" && parts.length === 2) {
      return respond(null, 302, {
        location: `/g/${parts[1]}/${requestLocale(request)}`,
        "cache-control": CACHE.private,
      });
    }
    if (parts[0] === "g" && (parts.length === 3 || parts.length === 4)) {
      return guidePage(request, parts[1]!, parts[2]!, parts[3]);
    }
    return unavailable(requestLocale(request));
  };
}
