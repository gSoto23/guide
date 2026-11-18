import { expect, test } from "@playwright/test";
import { propertyLink, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 009 US2 (quickstart 2, T015): the owner hides a category and an experience on a property,
 * and guests see the change without republishing; the workspace default applies to properties that
 * follow it. Synthetic partner data.
 */
test("quickstart 2: hosts choose what guests see", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signIn(page, uniqueEmail("explore-us2"));
  const guide = await publishGuide(page);
  const link = await propertyLink(page, guide);

  await page.goto(`/es/properties/${guide.propertyId}`);
  await page.getByRole("link", { name: "Elegir qué ven tus huéspedes" }).click();
  await expect(page.getByRole("heading", { name: "Explorar", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Experiencias cerca de Sámara" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel("Usar los valores del espacio de trabajo").uncheck();
  await page.getByLabel("Actividades en el agua").uncheck();
  const first = page.locator(".explore-row").first();
  const hiddenTitle = (await first.locator("strong").textContent())!;
  await first.getByLabel(/^Ocultar/).check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^Cambios guardados/)).toBeVisible();

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole("link", { name: "Explorar la zona" }).click();
  await expect(guest.getByRole("heading", { name: "Experiencias cerca de Sámara" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Actividades en el agua" })).toHaveCount(0);
  await expect(guest.getByRole("link", { name: hiddenTitle, exact: true })).toHaveCount(0);

  // The workspace default turns experiences off; the property follows it again.
  await page.goto("/es/settings/explore");
  await page.getByLabel("Mostrar experiencias de socios").uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^Cambios guardados/)).toBeVisible();
  await page.goto(`/es/properties/${guide.propertyId}/explore`);
  await page.getByLabel("Usar los valores del espacio de trabajo").check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^Cambios guardados/)).toBeVisible();
  await guest.reload();
  await expect(guest.getByText("Soda La Palma")).toBeVisible();
  await expect(guest.locator(".experience")).toHaveCount(0);
  await context.close();
});
