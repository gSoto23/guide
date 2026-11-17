import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/**
 * A local HTTPS iCal server for tests and development (feature 002 T065, quickstart 7). The feed
 * reader may reach it only because tests allowlist its single host (`SANDBOX_TEST_ALLOW_HOST`)
 * and trust its test-only certificate authority (`SANDBOX_TEST_CA_FILE`); production refuses
 * both (research R2). All calendars are fictional.
 */
export interface TestCertificates {
  caFile: string;
  key: string;
  cert: string;
}

/**
 * Creates (once) a test certificate authority and a certificate for `localhost` and 127.0.0.1,
 * with the openssl command-line tool. Test-only key material; never used anywhere else.
 */
export function createTestCertificates(dir: string): TestCertificates {
  mkdirSync(dir, { recursive: true });
  const path = (name: string) => join(dir, name);
  if (!existsSync(path("server.crt"))) {
    const run = (...args: string[]) => execFileSync("openssl", args, { stdio: "ignore" });
    run(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "30",
      "-subj",
      "/CN=Guidesk Test CA",
      "-keyout",
      path("ca.key"),
      "-out",
      path("ca.crt"),
    );
    run(
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-keyout",
      path("server.key"),
      "-out",
      path("server.csr"),
    );
    writeFileSync(path("server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
    run(
      "x509",
      "-req",
      "-in",
      path("server.csr"),
      "-CA",
      path("ca.crt"),
      "-CAkey",
      path("ca.key"),
      "-CAcreateserial",
      "-days",
      "30",
      "-extfile",
      path("server.ext"),
      "-out",
      path("server.crt"),
    );
  }
  return {
    caFile: path("ca.crt"),
    key: readFileSync(path("server.key"), "utf8"),
    cert: readFileSync(path("server.crt"), "utf8"),
  };
}

export interface CalendarEvent {
  uid: string;
  /** `YYYY-MM-DD`. */
  start: string;
  end: string;
  summary?: string;
  description?: string;
}

/** An iCal body for the given events (all-day dates, as OTA exports use). */
export function icsCalendar(events: CalendarEvent[]): string {
  const date = (value: string) => value.replaceAll("-", "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Guidesk Test//Fixture//EN"];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTART;VALUE=DATE:${date(event.start)}`,
      `DTEND;VALUE=DATE:${date(event.end)}`,
      ...(event.summary ? [`SUMMARY:${event.summary}`] : []),
      ...(event.description ? [`DESCRIPTION:${event.description}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export interface IcalServer {
  /** `https://localhost:<port>`. */
  origin: string;
  host: "localhost";
  caFile: string;
  /** The link of a named feed: `${origin}/feeds/<name>.ics`. */
  url(name: string): string;
  /** Sets or changes a feed's content during a test. */
  setFeed(name: string, events: CalendarEvent[]): void;
  /** How many times a feed was requested (conditional requests included). */
  hits(name: string): number;
  close(): Promise<void>;
}

/**
 * Starts the server. Routes:
 * - `/feeds/<name>.ics`: a feed set with `setFeed`, with an ETag (304 on a matching If-None-Match);
 * - `/redirect-local.ics`: a redirect to `https://127.0.0.1:<port>/…`, which the reader must refuse;
 * - `/slow.ics`: answers after 12 seconds (the read limit is 10);
 * - `/big.ics`: a 3 MB body (the limit is 2 MB);
 * - `/not-ical.html`: an HTML page.
 */
export async function startIcalServer(certificateDir: string): Promise<IcalServer> {
  const certificates = createTestCertificates(certificateDir);
  const feeds = new Map<string, string>();
  const counts = new Map<string, number>();
  let port = 0;
  const server: Server = createServer(
    { key: certificates.key, cert: certificates.cert },
    (request, response) => {
      const path = new URL(request.url ?? "/", "https://localhost").pathname;
      const feed = /^\/feeds\/([\w-]+)\.ics$/.exec(path)?.[1];
      if (feed !== undefined) {
        counts.set(feed, (counts.get(feed) ?? 0) + 1);
        const body = feeds.get(feed);
        if (body === undefined) {
          response.writeHead(404).end();
          return;
        }
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304, { etag }).end();
          return;
        }
        response.writeHead(200, { "content-type": "text/calendar; charset=utf-8", etag }).end(body);
        return;
      }
      if (path === "/redirect-local.ics") {
        response.writeHead(302, { location: `https://127.0.0.1:${port}/feeds/any.ics` }).end();
        return;
      }
      if (path === "/slow.ics") {
        const timer = setTimeout(() => response.writeHead(200).end(icsCalendar([])), 12_000);
        response.on("close", () => clearTimeout(timer));
        return;
      }
      if (path === "/big.ics") {
        response.writeHead(200, { "content-type": "text/calendar" });
        response.end(Buffer.alloc(3 * 1024 * 1024, 65));
        return;
      }
      if (path === "/not-ical.html") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end("<html><body>Not a calendar</body></html>");
        return;
      }
      response.writeHead(404).end();
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  const origin = `https://localhost:${port}`;
  return {
    origin,
    host: "localhost",
    caFile: certificates.caFile,
    url: (name) => `${origin}/feeds/${name}.ics`,
    setFeed: (name, events) => feeds.set(name, icsCalendar(events)),
    hits: (name) => counts.get(name) ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
