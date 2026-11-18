import { expect, test } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 005 US4 (quickstart scenario 4, T034), on feature 007's settings screen: the owner lets
 * every topic answer on its own for the workspace, then gives a property its own levels (drafts)
 * and goes back to following the workspace.
 */
test("quickstart 4: assistant settings", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("chat-us4"));
  const guide = await publishGuide(page);

  await page.goto("/es/settings/assistant");
  const levels = page.locator(".topic-rows");
  await expect(levels.getByLabel("Llegada y acceso")).toHaveValue("draft");
  for (const select of await levels.getByRole("combobox").all()) await select.selectOption("auto");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Ajustes guardados.")).toBeVisible();

  await page.goto(`/es/properties/${guide.propertyId}/assistant`);
  const autonomy = page.locator("section.card", { hasText: "Cuándo responde solo" });
  await expect(autonomy.getByLabel("Llegada y acceso")).toHaveValue("auto");
  await autonomy.getByLabel("Usar los ajustes del espacio").uncheck();
  for (const select of await autonomy.getByRole("combobox").all()) await select.selectOption("draft");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Ajustes guardados.")).toBeVisible();
  const own = await (await page.request.get(`${guide.base}/assistant`)).json();
  expect(own.effective.autonomy.arrival).toBe("draft");

  await page.reload();
  await page.locator("section.card", { hasText: "Cuándo responde solo" }).getByLabel("Usar los ajustes del espacio").check();
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Ajustes guardados.")).toBeVisible();
  const following = await (await page.request.get(`${guide.base}/assistant`)).json();
  expect(following.effective.autonomy.arrival).toBe("auto");
  expect(following.own.autonomy.arrival).toBe("draft");
});
