import { expect, test } from "@playwright/test";
import { addStay, propertyLink, publishGuide, signIn, uniqueEmail } from "../helpers/guest";
import { addExtra, costaRicaDay, stayLinkFor } from "../helpers/extras";

/**
 * Feature 008 US2 (quickstart 2, T016): with the stay link, the guest requests the pickup (waiting)
 * and the pre-approved bike (confirmed), sees a rule explained, and cancels; on the property link,
 * Request isn't offered. Fictional data.
 */
test("quickstart 2: guests request extras", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signIn(page, uniqueEmail("extras-us2"));
  const guide = await publishGuide(page);
  const stay = await addStay(page, guide, 0, 4);
  const pickup = await addExtra(page, guide, {
    name: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
    price: 85,
    leadTimeHours: 24,
    needsDate: true,
    needsTime: true,
  });
  await addExtra(page, guide, {
    name: { es: "Alquiler de bicicleta", en: "Bike rental" },
    price: 15,
    needsDate: true,
    preApproved: true,
  });
  const stayLink = await stayLinkFor(page, guide, stay.id);

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(stayLink);
  await expect(guest).toHaveURL(/\/g\/[a-z2-7]{26}\/es$/);
  await guest.getByRole("link", { name: "Servicios extra" }).click();
  await expect(guest.getByRole("heading", { name: "Servicios extra", level: 1 })).toBeVisible();
  await expect(guest.getByText("Ofrecido por tu anfitrión").first()).toBeVisible();

  await guest.getByRole("link", { name: "Recogida en el aeropuerto" }).click();
  await expect(guest.getByRole("heading", { name: "Recogida en el aeropuerto", level: 1 })).toBeVisible();
  await expect(guest.getByLabel("Fecha")).toBeVisible();
  await expect(guest.getByText("No incluyas teléfonos, correos ni documentos.")).toBeVisible();
  // Today is too soon for 24 hours of notice: the rule is explained and nothing is stored.
  await guest.getByLabel("Fecha").fill(costaRicaDay(0));
  await guest.getByLabel("Hora").fill("08:00");
  await guest.getByRole("button", { name: "Pedir", exact: true }).click();
  await expect(guest.getByText(/^Hace falta más anticipación/)).toBeVisible();
  await guest.getByLabel("Fecha").fill(costaRicaDay(2));
  await guest.getByLabel("Hora").fill("14:30");
  await guest.getByLabel("Nota para tu anfitrión (opcional)").fill("Llegamos en el vuelo de la tarde");
  await guest.getByRole("button", { name: "Pedir", exact: true }).click();
  await expect(guest.getByText("Listo. Tu solicitud está esperando a tu anfitrión.")).toBeVisible();
  await expect(guest.getByText("Esperando a tu anfitrión").first()).toBeVisible();

  await guest.getByRole("link", { name: "Volver a Servicios extra" }).click();
  await guest.getByRole("link", { name: "Alquiler de bicicleta" }).click();
  await guest.getByLabel("Fecha").fill(costaRicaDay(1));
  await guest.getByRole("button", { name: "Pedir", exact: true }).click();
  await expect(guest.getByText(/^Listo\. Tu solicitud quedó confirmada/)).toBeVisible();

  // The guest cancels the waiting pickup.
  await guest.goto(guest.url().replace(/\/extras\/.*$/, `/extras/${pickup.id}`));
  const requests = guest.locator("[data-extra-requests]");
  await expect(requests.getByText("Esperando a tu anfitrión")).toBeVisible();
  await requests.getByRole("button", { name: "Cancelar solicitud" }).first().click();
  await expect(guest.getByText("Cancelaste la solicitud.")).toBeVisible();
  await context.close();

  // On the property link there is no stay session: no form, a note instead.
  const visitorContext = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const visitor = await visitorContext.newPage();
  await visitor.goto(await propertyLink(page, guide));
  await visitor.getByRole("link", { name: "Servicios extra" }).click();
  await visitor.getByRole("link", { name: "Recogida en el aeropuerto" }).click();
  await expect(visitor.getByText(/^Para pedirlo, abre la guía desde el enlace de tu estadía/)).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Pedir", exact: true })).toBeHidden();
  await visitorContext.close();
});
