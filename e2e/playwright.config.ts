import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (spec 001 quickstart). Requires local services (docker compose up), the API,
 * and the portal with API_PROXY_URL so /api/* reaches the API through the portal's origin.
 */
const baseURL = process.env.PORTAL_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "es-CR",
  },
  projects: [
    // Mobile first (NFR-12). Chromium only: the virtual WebAuthn authenticator needs CDP.
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
