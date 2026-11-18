import { expect, test } from "@playwright/test";
import { addStay, LOCKBOX, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 004 US3 (quickstart scenario 3, T044): with the confirmation code on, the guest is asked
 * for it before the first code; a wrong code is refused; the right one shows the value; the same
 * device is not asked again. All data is fictional.
 */
test("quickstart 3: confirmation code", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("guest-us3"));
  const guide = await publishGuide(page);
  await addStay(page, guide, 0);

  await page.goto(`/es/properties/${guide.propertyId}/share`);
  await page.getByLabel("Pedir un código de confirmación").check();
  await expect(page.getByText("Los huéspedes deben escribir el código de su estadía la primera vez.")).toBeVisible();
  await page.getByRole("button", { name: "Copiar enlace de estadía" }).first().click();
  const row = page.locator(".stay-row").first();
  const stayLink = (await row.locator(".share-url code").textContent()) ?? "";
  const codeText = (await row.getByText(/^Código de confirmación: /).textContent()) ?? "";
  const code = codeText.replace("Código de confirmación: ", "").trim();
  expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

  const guestContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  await guest.goto(stayLink);
  await guest.getByRole("link", { name: "Arrival and access" }).click();
  await guest.getByRole("button", { name: "Show code" }).first().click();
  const dialog = guest.getByRole("dialog", { name: "Confirm your booking" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Confirmation code").fill("ZZZZZZ");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByText("That code isn't right. 4 tries left.")).toBeVisible();
  await dialog.getByLabel("Confirmation code").fill(code.toLowerCase());
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(guest.locator(".locked-value").first()).toHaveText(LOCKBOX);
  await guest.reload();
  await guest.getByRole("button", { name: "Show code" }).first().click();
  await expect(guest.locator(".locked-value").first()).toHaveText(LOCKBOX);
  await expect(guest.getByRole("dialog")).toHaveCount(0);
  await guestContext.close();
});
