import { loadAssets } from "./assets.js";
import { loadConfig } from "./config.js";
import { createHandler } from "./handler.js";

/**
 * AWS Lambda adapter for the guest app behind CloudFront (feature 004 research R3). The function
 * URL event (payload v2) becomes a web Request; the Response becomes the function result.
 */
interface UrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  requestContext: { http: { method: string } };
}

interface UrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

const handle = createHandler({ config: loadConfig(), assets: loadAssets() });

export async function handler(event: UrlEvent): Promise<UrlResult> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const url = `https://${host}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
  const response = await handle(
    new Request(url, { method: event.requestContext.http.method, headers }),
  );
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  const type = response.headers.get("content-type") ?? "";
  const binary = !/^(text\/|application\/(json|manifest\+json|javascript))|image\/svg/.test(type);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    statusCode: response.status,
    headers: out,
    body: binary ? bytes.toString("base64") : bytes.toString("utf8"),
    isBase64Encoded: binary,
  };
}
