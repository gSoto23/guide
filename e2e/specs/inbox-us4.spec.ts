import { expect, test } from "@playwright/test";
import { signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 006 US4 (T027): the portal is installable (manifest) and serves its push service worker;
 * without VAPID keys (local runs), the alerts card says push isn't available and email still works.
 */
test("quickstart 4: alerts card, manifest, and service worker", async ({ page }) => {
  test.setTimeout(90_000);
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ name: "Guidesk", display: "standalone" });
  const worker = await page.request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(await worker.text()).toContain("notificationclick");

  await signIn(page, uniqueEmail("inbox-us4"));
  await page.goto("/es/settings/account");
  const card = page.locator("section.card", { hasText: "Alertas en este dispositivo" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText(
      /no están disponibles en esta instalación|no admite alertas push|Activar alertas/,
    ),
  ).toBeVisible();
  const csp =
    (await page.request.get("/es/settings/account")).headers()["content-security-policy"] ?? "";
  expect(csp).toContain("worker-src 'self'");
});
