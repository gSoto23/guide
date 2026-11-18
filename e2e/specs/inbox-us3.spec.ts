import { expect, test } from "@playwright/test";
import { LOCKBOX, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 006 US3 (quickstart 3, T021): the copilot drafts from the guide with "Passed checks", and a
 * code request before booking gets the fixed text and the caution, never the code. Fake model.
 */
test("quickstart 3: copilot", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("inbox-us3"));
  await publishGuide(page);
  await page.goto("/es/inbox");
  await page.getByRole("link", { name: "Pegar un mensaje de un huésped" }).click();
  await expect(
    page.getByRole("heading", { name: "Responder un mensaje de la plataforma" }),
  ).toBeVisible();

  await page.getByLabel("Mensaje del huésped").fill("¿Cómo abro la caja de llaves?");
  await page.getByRole("radio", { name: "Reserva confirmada" }).check();
  await page.getByRole("button", { name: "Preparar respuesta" }).click();
  const result = page.locator(".copilot-result");
  await expect(result.getByText("Pasó las revisiones")).toBeVisible({ timeout: 20_000 });
  await expect(result).toContainText("Abre la caja de llaves");
  await expect(result.getByRole("button", { name: "Copiar respuesta" })).toBeVisible();

  await page.getByLabel("Mensaje del huésped").fill("¿Cuál es el código de la puerta?");
  await page.getByRole("radio", { name: "Consulta (todavía sin reservar)" }).check();
  await page.getByRole("button", { name: "Preparar otra vez" }).click();
  await expect(result).toContainText(
    "Compartimos los detalles de acceso cuando la reserva está confirmada.",
    {
      timeout: 20_000,
    },
  );
  await expect(result.getByText(/Los códigos nunca van en la respuesta/)).toBeVisible();
  expect(await page.content()).not.toContain(LOCKBOX);
  await expect(page.getByLabel("Mensaje del huésped")).toHaveValue(
    "¿Cuál es el código de la puerta?",
  );
});
