import { expect, test } from "@playwright/test";
import { addStay, LOCKBOX, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 004 US4 (quickstart scenario 4, T052): the owner prepares the stay message in English,
 * first without codes and then with them; the text carries the stay link and the arrival steps.
 * All data is fictional.
 */
test("quickstart 4: stay message", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("guest-us4"));
  const guide = await publishGuide(page);
  await addStay(page, guide, 1);

  await page.goto(`/es/properties/${guide.propertyId}/share`);
  await page.getByRole("button", { name: "Mensaje de estadía" }).first().click();
  const panel = page.locator(".stay-message").first();
  await panel.getByLabel("Idioma del mensaje").selectOption("en");
  await panel.getByRole("button", { name: "Preparar mensaje" }).click();
  const text = panel.locator(".share-message");
  await expect(text).toContainText("Hi! Everything is ready for your stay at Casa Colibrí.");
  await expect(text).toContainText("Open the lockbox with Caja de llaves (shown in your stay link).");
  await expect(text).not.toContainText(LOCKBOX);
  await expect(text).toContainText(/\/s\/[A-Za-z0-9_-]{43}/);

  await panel.getByLabel("Incluir los códigos de acceso (queda registrado)").check();
  await panel.getByRole("button", { name: "Preparar mensaje" }).click();
  await expect(panel.locator(".share-message")).toContainText(LOCKBOX);
});
