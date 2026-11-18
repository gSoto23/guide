import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { loadAssets } from "./assets.js";
import { loadConfig } from "./config.js";
import { createHandler } from "./handler.js";

/**
 * Local development server (feature 004 research R2): the guest app on 127.0.0.1:3001, a
 * different host from the portal's localhost:3000 so the two cookie jars never mix. It forwards
 * /api/* to the API, as CloudFront does in AWS, so guest calls are same-origin.
 */
const port = Number(process.env.GUIDE_PORT ?? 3001);
const host = process.env.GUIDE_HOST ?? "127.0.0.1";
const apiProxy = new URL(process.env.API_PROXY_URL ?? "http://localhost:4000");
const config = loadConfig();
const handle = createHandler({ config, assets: loadAssets() });

function proxy(req: IncomingMessage, res: import("node:http").ServerResponse): void {
  const forwardedFor = [req.headers["x-forwarded-for"], req.socket.remoteAddress]
    .filter(Boolean)
    .join(", ");
  const upstream = httpRequest(
    {
      host: apiProxy.hostname,
      port: apiProxy.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: apiProxy.host, "x-forwarded-for": forwardedFor },
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("API unavailable");
  });
  req.pipe(upstream);
}

createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    if (!headers.has("x-forwarded-for") && req.socket.remoteAddress) {
      headers.set("x-forwarded-for", req.socket.remoteAddress);
    }
    const response = await handle(new Request(url, { method: req.method, headers }));
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      out[key] = value;
    });
    res.writeHead(response.status, out);
    if (response.body && req.method !== "HEAD") {
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("guide request failed", error instanceof Error ? error.message : "unknown");
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal error");
  }
}).listen(port, host, () => {
  console.warn(`Guest guide on http://${host}:${port}`);
});
