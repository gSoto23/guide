import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  GUIDE_URL,
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

/**
 * Feature 005 US5 (quickstart scenario 5, T038): a device that sends more than 20 messages in 10
 * minutes is paused with a message that points to the booking platform. Daily AI budgets are set by
 * Guidesk, so they are covered by the worker tests rather than here. Fictional data.
 */
test("quickstart 5: device limit", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("chat-us5"));
  const guide = await publishGuide(page);
  const link = await propertyLink(page, guide);
  const publicId = link.split("/g/")[1]!;

  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  await sendChatMessage(guest, "Hola");
  // The same device (same chat cookie) sends 19 more messages.
  for (let i = 0; i < 19; i += 1) {
    const response = await guest.request.post(`${GUIDE_URL}/api/v1/guest/chat/messages`, {
      data: { publicId, text: `Pregunta ${i}`, language: "es", clientId: randomUUID() },
    });
    expect(response.status()).toBe(202);
  }
  const dialog = guest.getByRole("dialog");
  await dialog.getByLabel("Tu mensaje").fill("¿Una más?");
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enviaste muchos mensajes");
  await expect(dialog.getByRole("alert")).toContainText("plataforma de tu reserva");
  await context.close();
});
