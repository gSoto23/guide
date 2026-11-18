import { expect, test } from "@playwright/test";
import { addStay, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 004 US6 (quickstart scenario 6, T061): two devices open the property link and one opens
 * a stay link; the Share screen shows the opens and the stay's device count. All data is
 * fictional.
 */
test("quickstart 6: counts", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("guest-us6"));
  const guide = await publishGuide(page);
  const stay = await addStay(page, guide, 0);
  const share = (await (await page.request.get(`${guide.base}/share`)).json()) as {
    propertyLink: { url: string };
  };
  const copied = await page.request.post(`${guide.base}/share/stays/${stay.id}/link`, { data: {} });
  const { url: stayUrl } = (await copied.json()) as { url: string };

  for (const target of [share.propertyLink.url, share.propertyLink.url, stayUrl]) {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
    const guest = await context.newPage();
    const counted = guest.waitForResponse((response) => response.url().endsWith("/api/v1/guest/opens"));
    await guest.goto(target);
    expect((await counted).status()).toBe(204);
    await context.close();
  }

  await page.goto(`/es/properties/${guide.propertyId}/share`);
  await expect(page.getByText("Abierta 3 veces en los últimos 30 días")).toBeVisible();
  await expect(page.getByText(/Abierto en 1 dispositivo/)).toBeVisible();
});
