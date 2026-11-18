import { expect, test } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 007 US5 (quickstart scenario 6, T038): on the property's assistant screen the owner tests
 * a question and sees the topic, the outcome under the saved settings (drafts by default), and the
 * text; no conversation is created. Fake model; fictional data.
 */
test("quickstart 6: test the assistant", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("settings-us5"));
  const guide = await publishGuide(page);

  await page.goto(`/es/properties/${guide.propertyId}/assistant`);
  const panel = page.locator("section.card", { hasText: "Probar el asistente" });
  await panel.getByLabel("Pregunta").fill("¿Cómo abro la caja de llaves?");
  await panel.getByRole("button", { name: "Probar" }).click();
  await expect(panel.getByText("Resultado: Borrador para tu equipo")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("Tema: Llegada y acceso")).toBeVisible();
  await expect(panel.getByText("Abre la caja de llaves")).toBeVisible();
  const conversations = await (await page.request.get(`${guide.base}/conversations`)).json();
  expect(conversations).toEqual([]);
});
