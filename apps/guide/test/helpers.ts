import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../src/handler.js";
import { FIXTURE_PUBLIC_ID } from "../src/fixtures/guide.js";

export { FIXTURE_PUBLIC_ID };

/** A handler over the fixture guide, with no built assets needed. */
export function fixtureHandler(overrides: { secure?: boolean } = {}) {
  return createHandler({
    config: {
      apiUrl: "http://api.invalid",
      mediaOrigin: "https://media.example.com",
      secure: overrides.secure ?? false,
      fixtures: true,
      edgeSecret: null,
      experienceImageOrigins: ["https://media.example-cdn.test"],
      portalUrl: "http://localhost:3000",
    },
    assets: {
      script: "/assets/guide.test.js",
      style: "/assets/guide.test.css",
      chatScript: "/assets/chat.test.js",
      chatStyle: "/assets/chat.test.css",
      publicDir: join(fileURLToPath(new URL(".", import.meta.url)), "fixtures-public"),
    },
  });
}

export function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:3001${path}`, { headers });
}
