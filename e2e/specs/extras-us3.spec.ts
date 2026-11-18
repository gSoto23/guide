import { expect, test } from "@playwright/test";
import { addStay, publishGuide, signIn, uniqueEmail } from "../helpers/guest";
import { addExtra, costaRicaDay, stayLinkFor } from "../helpers/extras";
import { waitForSubject } from "../helpers/mailpit";

/**
 * Feature 008 US3 (quickstart 3, T016): the contacts get an email for each new request; in Requests
 * the owner confirms the pickup and declines the cleaning with a reason; the guest sees each status.
 * Fictional data.
 */
test("quickstart 3: hosts answer requests", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail("extras-us3");
  await signIn(page, email);
  const guide = await publishGuide(page);
  const stay = await addStay(page, guide, 0, 4);
  const pickup = await addExtra(page, guide, {
    name: { es: "Recogida en el aeropuerto" },
    price: 85,
    needsDate: true,
  });
  const cleaning = await addExtra(page, guide, { name: { es: "Limpieza adicional" }, price: 30, needsDate: true });
  const stayLink = await stayLinkFor(page, guide, stay.id);

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(stayLink);
  await expect(guest).toHaveURL(/\/g\/[a-z2-7]{26}\/es$/);
  const home = guest.url();
  for (const extra of [pickup, cleaning]) {
    await guest.goto(`${home}/extras/${extra.id}`);
    await guest.getByLabel("Fecha").fill(costaRicaDay(2));
    await guest.getByRole("button", { name: "Pedir", exact: true }).click();
    await expect(guest.getByText("Listo. Tu solicitud está esperando a tu anfitrión.")).toBeVisible();
  }

  // The per-minute job alerts the contacts by email, without the guest's text.
  await waitForSubject(email, "Nueva solicitud en Casa Colibrí: Recogida en el aeropuerto", 120_000);

  await page.goto("/es/inbox");
  await page.getByRole("link", { name: "Solicitudes" }).click();
  await expect(page.getByRole("heading", { name: "Solicitudes", level: 1 })).toBeVisible();
  await expect(page.getByText("2 en espera")).toBeVisible();
  const pickupRow = page.locator(".request-row").filter({ hasText: "Recogida en el aeropuerto" });
  const cleaningRow = page.locator(".request-row").filter({ hasText: "Limpieza adicional" });
  await pickupRow.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText(/^Confirmada\. El huésped lo ve en la guía/)).toBeVisible();
  await expect(pickupRow).toContainText("Confirmada");
  await cleaningRow.getByRole("button", { name: "Rechazar" }).click();
  await cleaningRow.getByLabel("Sin cupo").check();
  await cleaningRow.getByLabel("Mensaje para el huésped (opcional)").fill("Esa semana no tenemos personal.");
  await cleaningRow.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/^Rechazada\. El huésped ve el motivo/)).toBeVisible();
  await expect(cleaningRow).toContainText("Rechazada");

  // The status filter keeps only confirmed requests.
  await page.getByLabel("Estado").selectOption("confirmed");
  await expect(page.locator(".request-row")).toHaveCount(1);

  await guest.goto(`${home}/extras/${pickup.id}`);
  await expect(
    guest.locator("[data-extra-requests]").getByText(/^Confirmada: tu anfitrión acordará el pago/),
  ).toBeVisible();
  await guest.goto(`${home}/extras/${cleaning.id}`);
  const declined = guest.locator("[data-extra-requests]");
  await expect(declined.getByText("No disponible", { exact: true })).toBeVisible();
  await expect(declined.getByText(/Ya no hay cupo\. Esa semana no tenemos personal\./)).toBeVisible();
  await expect(declined.getByText("No se cobró nada.")).toBeVisible();
  await context.close();
});
