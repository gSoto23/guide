import { expect, test } from "@playwright/test";
import {
  addStay,
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  setAutonomy,
  signIn,
  uniqueEmail,
} from "../helpers/guest";
import { stayLinkFor } from "../helpers/extras";

/**
 * Feature 010 US1 and US2 (quickstart 1 and 2, T015): guests open the guide from the property link
 * and a stay link and ask two questions; the property's Analytics shows the views, the stay that
 * opened the guide, the questions by outcome with the rate, and the unanswered question with a link to
 * its conversation. Fake model; fictional data.
 */
test("quickstart 1 and 2: a property's analytics", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail("analytics-us1"));
  const guide = await publishGuide(page);
  await setAutonomy(page, guide, "auto");
  const stay = await addStay(page, guide, 0, 3);
  const stayLink = await stayLinkFor(page, guide, stay.id);

  const visitor = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await visitor.newPage();
  await guest.goto(await propertyLink(page, guide));
  await openChat(guest);
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  const dialog = guest.getByRole("dialog");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText("Abre la caja de llaves", {
    timeout: 15_000,
  });
  await sendChatMessage(guest, "¿Venden helados de mango?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "No encuentro esto en la guía",
    { timeout: 15_000 },
  );
  await visitor.close();

  const staying = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const stayGuest = await staying.newPage();
  await stayGuest.goto(stayLink);
  await expect(stayGuest).toHaveURL(/\/g\/[a-z2-7]{26}\/es$/);
  await expect(stayGuest.getByRole("heading", { name: "Tu estadía" })).toBeVisible();
  await staying.close();

  await page.goto(`/es/properties/${guide.propertyId}`);
  await page.getByRole("link", { name: "Ver estadísticas" }).click();
  await expect(page.getByRole("heading", { name: "Estadísticas: Casa Colibrí", level: 1 })).toBeVisible();
  const card = (label: string) =>
    page.locator(".metric").filter({ has: page.locator(".metric-label").getByText(label, { exact: true }) });
  await expect(card("Visitas a la guía").locator(".metric-value")).toHaveText("2");
  await expect(card("Visitas a la guía")).toContainText(
    "1 desde el enlace de la propiedad, 1 desde enlaces de estadía",
  );
  await expect(card("Estadías que abrieron la guía").locator(".metric-value")).toHaveText("1");
  await expect(card("Preguntas de huéspedes").locator(".metric-value")).toHaveText("2");
  await expect(card("Tasa de resolución automática").locator(".metric-value")).toHaveText(/^50\s?%$/);
  // The property is new: one note says there's nothing to compare with yet.
  await expect(page.getByText(/^Aún sin comparación/)).toHaveCount(1);

  const outcomes = page.getByRole("list", { name: "Preguntas por resultado" });
  await expect(outcomes.locator(".bar-row").filter({ hasText: "Respondidas automáticamente" })).toContainText("1");
  await expect(outcomes.locator(".bar-row").filter({ hasText: "Enviadas a ti" })).toContainText("1");

  const unanswered = page.locator(".unanswered-item").filter({ hasText: "¿Venden helados de mango?" });
  await expect(unanswered).toBeVisible();
  await page.getByLabel("7 días").check();
  await expect(card("Preguntas de huéspedes").locator(".metric-value")).toHaveText("2");
  await unanswered.getByRole("link", { name: "Abrir la conversación" }).click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
  await expect(page.getByText("¿Venden helados de mango?")).toBeVisible();
});
