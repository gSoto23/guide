import { expect, test } from "@playwright/test";
import { propertyLink, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 009 US1 (quickstart 1, T010): a guest opens Explore from the guide, sees the host's tips
 * first, then experiences by category with the disclosure, opens one, and "Book on Viator" goes
 * through Guidesk's click address to the partner page with tracking. Synthetic partner data
 * (EXPERIENCES_MODE=fixtures); the test never opens the partner's site.
 */
test("quickstart 1: guests discover experiences", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("explore-us1"));
  const guide = await publishGuide(page);
  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole("link", { name: "Explorar la zona" }).click();
  await expect(guest.getByRole("heading", { name: "Explorar", level: 1 })).toBeVisible();
  const tips = guest.getByRole("heading", { name: "Recomendaciones de tu anfitrión" });
  const near = guest.getByRole("heading", { name: "Experiencias cerca de Sámara" });
  // Experiences come from the worker's refresh, which runs at start and every 30 minutes.
  await expect(near).toBeVisible({ timeout: 20_000 });
  expect((await tips.boundingBox())!.y).toBeLessThan((await near.boundingBox())!.y);
  await expect(guest.getByText("Soda La Palma")).toBeVisible();
  const cards = guest.locator(".experience");
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(12);
  await expect(
    guest.getByText("Guidesk podría recibir una comisión si reservas, sin costo extra para ti."),
  ).toHaveCount(count + 1);

  await cards.first().getByRole("link").click();
  const book = guest.getByRole("link", { name: "Reservar en Viator" });
  await expect(book).toBeVisible();
  await expect(book).toHaveAttribute("target", "_blank");
  await expect(book).toHaveAttribute("rel", /noreferrer/);
  const href = await book.getAttribute("href");
  expect(href).toMatch(/^\/api\/v1\/guest\/guides\/[a-z2-7]{26}\/experiences\/viator-[A-Za-z0-9_-]+\/go\?lang=es$/);
  const redirect = await guest.request.get(`${new URL(guest.url()).origin}${href}&c=1`, {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toMatch(/^https:\/\/www\.viator\.com\/.*pid=/);
  await context.close();
});
