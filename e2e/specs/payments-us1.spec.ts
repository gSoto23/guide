import { expect, test } from "@playwright/test";
import { addStay, publishGuide, signIn, uniqueEmail } from "../helpers/guest";
import { addExtra, stayLinkFor } from "../helpers/extras";
import { waitForSubject } from "../helpers/mailpit";

/**
 * Feature 013 US2 and US1 (quickstart 1 and 2, T021): the owner sets up payouts on the simulated
 * provider's page; the guest pays a pre-approved extra there and the guide shows it paid once the
 * provider confirms it; the contacts get the "paid" email. Simulated provider; fictional data.
 */
test("quickstart 1 and 2: payouts and a guest payment", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = uniqueEmail("payments-us1");
  await signIn(page, owner);
  const guide = await publishGuide(page);
  const stay = await addStay(page, guide, 0, 4);
  await addExtra(page, guide, {
    name: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
    price: 85,
    preApproved: true,
  });
  const stayLink = await stayLinkFor(page, guide, stay.id);

  await page.goto("/es/settings");
  await page.getByRole("link", { name: "Pagos" }).click();
  await expect(page.getByRole("heading", { name: "Pagos", level: 1 })).toBeVisible();
  await expect(page.getByText("Comisión de Guidesk: 10 %.")).toBeVisible();
  await page.getByRole("button", { name: "Configurar pagos" }).click();
  await expect(page.getByText("Simulated payment provider")).toBeVisible();
  await page.getByRole("link", { name: "Approve the account" }).click();
  await expect(page).toHaveURL(/\/es\/settings\/payouts$/);
  await expect(page.getByText("Activa", { exact: true })).toBeVisible();

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(stayLink);
  await guest.getByRole("link", { name: "Servicios extra" }).click();
  await guest.getByRole("link", { name: "Recogida en el aeropuerto" }).click();
  await guest.getByRole("button", { name: "Pedir", exact: true }).click();
  await expect(guest.getByText(/^Listo\. Tu solicitud quedó confirmada/)).toBeVisible();
  await expect(guest.getByText(/^Total: .*85/)).toBeVisible();
  await guest.getByRole("button", { name: /^Pagar / }).click();
  await expect(guest.getByText("Simulated payment provider")).toBeVisible();
  await guest.getByRole("link", { name: /^Pay / }).click();
  await expect(guest).toHaveURL(/\/extras\?payment=/);
  await expect(guest.getByText(/^Pagado /).first()).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByText(/^Referencia del pago: sim_/).first()).toBeVisible();
  await context.close();

  // The worker emails the property's contacts once the provider confirms the payment.
  const subject = await waitForSubject(owner, "Pagado: Recogida en el aeropuerto", 60_000);
  expect(subject).toMatch(/^Pagado: Recogida en el aeropuerto/);
});
