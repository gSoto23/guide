import { expect, test } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 005 US4 (quickstart scenario 4, T034): the owner switches the workspace default to
 * automatic in workspace settings, then sets a property back to drafts and clears the override.
 */
test("quickstart 4: assistant settings", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("chat-us4"));
  const guide = await publishGuide(page);

  await page.goto("/es/settings/workspace");
  const workspaceCard = page.locator("section.card", { hasText: "Asistente del chat" });
  await expect(workspaceCard.getByRole("radio", { name: /^Borradores/ })).toBeChecked();
  await workspaceCard.getByRole("radio", { name: /^Automático/ }).check();
  await expect(workspaceCard.getByText("Ajuste guardado.")).toBeVisible();

  await page.goto(`/es/properties/${guide.propertyId}`);
  const propertyCard = page.locator("section.card", { hasText: "Asistente del chat" });
  await expect(propertyCard.getByRole("radio", { name: "Usar el ajuste del espacio (automático)" })).toBeChecked();
  await propertyCard.getByRole("radio", { name: /^Borradores/ }).check();
  await expect(propertyCard.getByText("Ajuste guardado.")).toBeVisible();
  await page.reload();
  await expect(
    page.locator("section.card", { hasText: "Asistente del chat" }).getByRole("radio", { name: /^Borradores/ }),
  ).toBeChecked();
  const settings = await page.request.get(`${guide.base}/assistant-settings`);
  expect(await settings.json()).toEqual({ override: "draft", effective: "draft" });
});
