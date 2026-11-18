import { expect, test } from "@playwright/test";
import {
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  setAutonomy,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

/**
 * Feature 005 US6 (quickstart scenario 6, T041): the owner opens "Why this reply" on an answer the
 * assistant sent on its own and sees the decision, topic, autonomy, guide version, and checks;
 * never the model, tokens, or cost. Fake model; fictional data.
 */
test("quickstart 6: why this reply", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("chat-us6"));
  const guide = await publishGuide(page);
  await setAutonomy(page, guide, "auto");
  const link = await propertyLink(page, guide);

  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toContainText(
    "Abre la caja de llaves",
    { timeout: 15_000 },
  );
  await context.close();

  await page.goto(`/es/properties/${guide.propertyId}/conversations`);
  await page.getByRole("link", { name: "Abrir conversación" }).first().click();
  const answer = page.locator(".transcript-assistant").last();
  await expect(answer).toContainText("Fuentes: Llegada y acceso");
  await answer.getByText("Por qué esta respuesta").click();
  await expect(answer.getByText("Decisión: Respondió solo")).toBeVisible();
  await expect(answer.getByText("Tema: arrival")).toBeVisible();
  await expect(answer.getByText("Autonomía: auto")).toBeVisible();
  await expect(answer.getByText("Versión publicada de la guía: 1")).toBeVisible();
  await expect(answer.getByText("Cita una sección publicada: Pasó")).toBeVisible();
  const text = (await page.locator("main").textContent()) ?? "";
  expect(text).not.toMatch(/claude|token|costo|cost|\$/i);
});
