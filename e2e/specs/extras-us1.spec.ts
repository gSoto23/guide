import { expect, test } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 008 US1 (quickstart 1, T016): the owner adds the suggested airport pickup, a pre-approved
 * bike rental, and a late checkout with the turnover rule, then copies the pickup to another
 * property. Fictional data.
 */
test("quickstart 1: the extras catalog", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, uniqueEmail("extras-us1"));
  await publishGuide(page, { name: "Casa Tucán" });
  const guide = await publishGuide(page);

  await page.goto(`/es/properties/${guide.propertyId}`);
  await page.getByRole("link", { name: "Gestionar extras" }).click();
  await expect(page.getByRole("heading", { name: "Extras", level: 1 })).toBeVisible();
  await expect(page.getByText("Todavía no hay extras.")).toBeVisible();

  // The suggestion opens a filled-in form; the host sets the price and saves.
  await page.getByRole("button", { name: "Recogida en el aeropuerto" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo extra" })).toBeVisible();
  await expect(page.getByLabel("Nombre en español")).toHaveValue("Recogida en el aeropuerto");
  await expect(page.getByLabel("El huésped elige fecha y hora")).toBeChecked();
  await page.getByLabel("Precio", { exact: true }).fill("85");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^Guardado\./)).toBeVisible();
  const pickup = page.locator(".extra-row").filter({ hasText: "Recogida en el aeropuerto" });
  await expect(pickup).toContainText("85");
  await expect(pickup).toContainText("24 horas de anticipación");
  await expect(pickup).toContainText("El huésped elige fecha y hora");

  // A wrong price is explained next to the field and nothing is saved.
  await page.getByRole("button", { name: "Agregar un extra" }).click();
  await page.getByLabel("Nombre en español").fill("Alquiler de bicicleta");
  await page.getByLabel("Precio", { exact: true }).fill("12.345");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Escribe un precio de 0 a 100.000 con hasta dos decimales.")).toBeVisible();
  await page.getByLabel("Precio", { exact: true }).fill("15");
  await page.getByLabel("El huésped elige una fecha").check();
  await page.getByLabel("Confirmar automáticamente las solicitudes que cumplan las reglas").check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^Guardado\./)).toBeVisible();
  await expect(page.locator(".extra-row").filter({ hasText: "Alquiler de bicicleta" })).toContainText(
    "Se confirma automáticamente",
  );

  await page.getByRole("button", { name: "Agregar un extra" }).click();
  await page.getByLabel("Nombre en español").fill("Salida tardía");
  await page.getByLabel("Precio", { exact: true }).fill("20");
  await page.getByLabel("Salida tardía (el día de salida)").check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^Guardado\./)).toBeVisible();
  await expect(page.locator(".extra-row")).toHaveCount(3);
  await expect(page.locator(".extra-row").nth(2)).toContainText("Salida tardía");

  // Order and hide.
  await page.getByRole("button", { name: "Subir “Salida tardía”" }).click();
  await expect(page.locator(".extra-row").nth(1)).toContainText("Salida tardía");
  await page.locator(".extra-row").filter({ hasText: "Salida tardía" }).getByRole("button", { name: "Ocultar" }).click();
  await expect(page.locator(".extra-row").filter({ hasText: "Salida tardía" })).toContainText(
    "Oculto para huéspedes",
  );

  // Copy the pickup to the other property.
  await pickup.getByRole("button", { name: "Copiar a otras propiedades" }).click();
  await pickup.getByLabel("Casa Tucán").check();
  await pickup.getByRole("button", { name: "Copiar", exact: true }).click();
  await expect(page.getByText("Copiado a 1 propiedad.")).toBeVisible();

  await page.goto(`/es/properties/${guide.propertyId}`);
  await expect(page.getByText("2 extras visibles para huéspedes")).toBeVisible();
});
