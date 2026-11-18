import { expect, test } from "@playwright/test";
import { addStay, LOCKBOX, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 004 US5 (quickstart scenario 5, T057): pages already viewed open offline with a banner;
 * the code asks for a connection; a page never opened says it isn't saved; no cache holds the
 * value. All data is fictional.
 */
test("quickstart 5: offline", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("guest-us5"));
  const guide = await publishGuide(page);
  const stay = await addStay(page, guide, 0);
  const copied = await page.request.post(`${guide.base}/share/stays/${stay.id}/link`, { data: {} });
  const { url } = (await copied.json()) as { url: string };

  const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(url);
  await expect(guest).toHaveURL(/\/g\/[a-z2-7]{26}\/en$/);
  await guest.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Visit again once the service worker controls the page, so the pages are saved.
  const home = guest.url();
  await guest.goto(home);
  await guest.getByRole("link", { name: "Arrival and access" }).click();
  const arrival = guest.url();
  await guest.getByRole("button", { name: "Show code" }).first().click();
  await expect(guest.locator(".locked-value").first()).toHaveText(LOCKBOX);

  await context.setOffline(true);
  await guest.goto(arrival);
  await expect(guest.getByText(/^Offline\. Saved copy from /)).toBeVisible();
  await expect(guest.getByText("Connect to the internet to show the code.").first()).toBeVisible();
  await guest.goto(home);
  await expect(guest.getByRole("heading", { name: "Casa Colibrí", level: 1 })).toBeVisible();
  await guest.getByRole("link", { name: "Wi-Fi" }).click();
  await expect(guest.getByText("This page isn't saved for offline use.")).toBeVisible();

  const cached = await guest.evaluate(async () => {
    const bodies: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response && response.type !== "opaque") bodies.push(await response.text());
      }
    }
    return bodies.join("\n");
  });
  expect(cached).toContain("Casa Colibrí");
  expect(cached).not.toContain(LOCKBOX);
  await context.close();
});
