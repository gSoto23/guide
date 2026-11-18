import { expect, test } from "@playwright/test";
import { GUIDE_URL, LOCKBOX, publishGuide, signIn, uniqueEmail, WIFI_PASSWORD } from "../helpers/guest";

/**
 * Feature 004 US1 (quickstart scenario 1, T023): the owner shares the property link and QR code;
 * a guest whose phone is in English opens the guide, sees placeholders instead of codes, the
 * public Wi-Fi password, and the benefit disclosure, switches to Spanish, and keeps that choice.
 * After unpublishing, the link shows the unavailable page. All data is fictional.
 */
test("quickstart 1: property link and QR", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("guest-us1"));
  const guide = await publishGuide(page, { publicWifi: true });

  await page.goto(`/es/properties/${guide.propertyId}/share`);
  await expect(page.getByRole("heading", { name: "Compartir la guía de Casa Colibrí" })).toBeVisible();
  await expect(page.getByText(/La guía es opcional para los huéspedes/)).toBeVisible();
  const link = (await page.locator(".share-url code").textContent()) ?? "";
  expect(link).toMatch(new RegExp(`^${GUIDE_URL.replace(/\./g, "\\.")}/g/[a-z2-7]{26}$`));
  const svg = await page.request.get(
    (await page.getByRole("link", { name: "Descargar SVG" }).getAttribute("href")) ?? "",
  );
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  await expect(page.locator(".share-message")).toContainText(link);

  const guestContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  await guest.goto(link);
  await expect(guest).toHaveURL(/\/en$/);
  await expect(guest.getByRole("heading", { name: "Casa Colibrí", level: 1 })).toBeVisible();
  await guest.getByRole("link", { name: "Arrival and access" }).click();
  // The Spanish item shows untranslated next to the English one: both carry the placeholder.
  await expect(guest.getByText("Codes appear only with your stay link.").first()).toBeVisible();
  await expect(
    guest.getByText("Your access details are also in your booking messages.").first(),
  ).toBeVisible();
  expect(await guest.content()).not.toContain(LOCKBOX);
  await guest.goto(link);
  await guest.getByRole("link", { name: "Wi-Fi" }).click();
  await expect(guest.getByText(WIFI_PASSWORD)).toBeVisible();
  await expect(guest.getByText("Not translated yet.")).toBeVisible();
  await guest.goto(link);
  await guest.getByRole("link", { name: "Recommendations" }).click();
  await expect(guest.getByText("Your host may receive a commission or other benefit from this business.")).toBeVisible();

  await guest.getByRole("link", { name: "Español" }).click();
  await expect(guest).toHaveURL(/\/es\/[0-9a-f-]{36}$/);
  await guest.goto(link);
  await expect(guest).toHaveURL(/\/es$/);
  await expect(guest.getByRole("link", { name: "Llegada y acceso" })).toBeVisible();

  const unpublished = await page.request.post(`${guide.base}/guide/unpublish`, { data: {} });
  expect(unpublished.ok()).toBe(true);
  // Locally there is no CDN: the next request reaches the origin.
  await guest.goto(`${link}/es`);
  await expect(guest.getByRole("heading", { name: "This guide isn't available" }).or(guest.getByRole("heading", { name: "Esta guía no está disponible" }))).toBeVisible();
  await guestContext.close();
});
