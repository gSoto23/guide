import { expect, test } from "@playwright/test";
import { addStay, publishGuide, signIn, uniqueEmail } from "../helpers/guest";
import { addExtra, stayLinkFor } from "../helpers/extras";

/**
 * Feature 013 US3 (quickstart 3, T021): after a guest pays, the owner sees the payment and its fees
 * on Requests, refunds part of it, and Payouts shows this month's totals. Simulated provider;
 * fictional data.
 */
test("quickstart 3: payments and refunds for hosts", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("payments-us3"));
  const guide = await publishGuide(page);
  const stay = await addStay(page, guide, 0, 4);
  await addExtra(page, guide, { name: { es: "Cesta de frutas" }, price: 40, preApproved: true });
  const stayLink = await stayLinkFor(page, guide, stay.id);
  const started = await page.request.post(
    `/api/v1/workspaces/${guide.workspaceId}/payouts/onboarding?lang=es`,
  );
  const { onboardingUrl } = (await started.json()) as { onboardingUrl: string };
  await page.goto(`${onboardingUrl}&action=approve`);

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(stayLink);
  await guest.getByRole("link", { name: "Servicios extra" }).click();
  await guest.getByRole("link", { name: "Cesta de frutas" }).click();
  await guest.getByRole("button", { name: "Pedir", exact: true }).click();
  await guest.getByRole("button", { name: /^Pagar / }).click();
  await guest.getByRole("link", { name: /^Pay / }).click();
  await expect(guest.getByText(/^Pagado /).first()).toBeVisible({ timeout: 15_000 });
  await context.close();

  await page.goto("/es/requests");
  const row = page.locator(".request-row").filter({ hasText: "Cesta de frutas" });
  await expect(row.getByText("Pagado", { exact: true })).toBeVisible();
  await expect(row.getByText(/Comisión de Guidesk .* tu parte/)).toBeVisible();
  await row.getByRole("button", { name: "Reembolsar" }).click();
  await row.getByLabel("Monto a reembolsar (USD)").fill("15");
  await row.getByRole("button", { name: "Confirmar el reembolso" }).click();
  await expect(row.getByText("Reembolsado en parte", { exact: true })).toBeVisible();

  await page.goto("/es/settings/payouts");
  const table = page.getByRole("table", { name: "Pagos de este mes por moneda" });
  await expect(table.getByRole("row", { name: /USD/ })).toBeVisible();
});
