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
 * Feature 007 US6 (quickstart scenario 7, T042): after an automatic answer, "Why this reply" on
 * the conversation page shows the topic's level and where it came from, the kind, and the tone.
 */
test("quickstart 7: settings in why this reply", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("settings-us6"));
  const guide = await publishGuide(page);
  await setAutonomy(page, guide, "auto");

  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
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
  await page.locator("a[href*='/conversations/']").first().click();
  await page.getByText("Por qué esta respuesta").first().click();
  await expect(
    page.getByText("Autonomía del tema: responde si está en la guía (ajuste del espacio)"),
  ).toBeVisible();
  await expect(page.getByText("Tipo de respuesta: De la guía")).toBeVisible();
  await expect(page.getByText("Tono: cercano")).toBeVisible();
});
