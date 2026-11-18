import { expect, test } from "@playwright/test";
import { addStay, LOCKBOX, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 004 US2 (quickstart scenario 2, T035): the owner copies a stay link; the guest's
 * browser swaps the token for a session and a clean address, sees the stay card, and shows the
 * code inside the window; a future stay shows when codes unlock; revoking ends the unlock at
 * once; the owner's reveal history lists the guest reveal. All data is fictional.
 */
test("quickstart 2: stay link", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("guest-us2"));
  const guide = await publishGuide(page);
  await addStay(page, guide, 0);
  await addStay(page, guide, 7);

  await page.goto(`/es/properties/${guide.propertyId}/share`);
  await expect(page.getByRole("heading", { name: "Estadías: enlaces que muestran los códigos" })).toBeVisible();
  await page.getByRole("button", { name: "Copiar enlace de estadía" }).first().click();
  const stayLink = (await page.locator(".stay-row .share-url code").first().textContent()) ?? "";
  expect(stayLink).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "Copiar enlace de estadía" }).first().click();
  const futureLink = (await page.locator(".stay-row .share-url code").nth(1).textContent()) ?? "";

  const guestContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  await guest.goto(stayLink);
  await expect(guest).toHaveURL(/\/g\/[a-z2-7]{26}\/en$/);
  expect(guest.url()).not.toContain("/s/");
  await expect(guest.getByRole("heading", { name: "Your stay" })).toBeVisible();
  await guest.getByRole("link", { name: "Arrival and access" }).click();
  const arrival = guest.url();
  await guest.getByRole("button", { name: "Show code" }).first().click();
  await expect(guest.locator(".locked-value").first()).toHaveText(LOCKBOX);
  await expect(guest.getByText("Your host can see when the code was viewed.").first()).toBeVisible();
  expect(await guest.locator(".locked-value").first().getAttribute("aria-label")).toBe(
    `Code: ${LOCKBOX.split("").join(" ")}`,
  );
  // The token page replaced itself in the history: going back never returns to it.
  await guest.goBack();
  await guest.goBack();
  expect(guest.url()).not.toContain("/s/");
  await guest.goto(arrival);

  const futureContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const future = await futureContext.newPage();
  await future.goto(futureLink);
  await expect(future).toHaveURL(/\/en$/);
  await future.getByRole("link", { name: "Arrival and access" }).click();
  await expect(future.getByText(/^Available from /).first()).toBeVisible();
  await futureContext.close();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Revocar" }).first().click();
  await expect(page.getByText("Revocado").first()).toBeVisible();
  await guest.reload();
  await expect(guest.getByText("Your stay has ended.").first()).toBeVisible();
  await expect(guest.getByRole("button", { name: "Show code" })).toHaveCount(0);

  await page.goto(`/es/properties/${guide.propertyId}/guide/locked-fields`);
  await expect(page.getByText(/Un huésped vio «Caja de llaves» con su enlace de estadía/)).toBeVisible();
  await guestContext.close();
});
