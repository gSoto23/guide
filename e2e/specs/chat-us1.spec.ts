import { expect, test } from "@playwright/test";
import {
  LOCKBOX,
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  setAutonomy,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

/**
 * Feature 005 US1 (quickstart scenario 1, T017): with autonomy "auto", a guest opens the chat from
 * the guide, sees the intro and suggestions, gets an answer from the guide with its section, a
 * pointer for a code (never the code), and a greeting. Fake model; fictional data.
 */
test("quickstart 1: ask the guide", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("chat-us1"));
  const guide = await publishGuide(page);
  await setAutonomy(page, guide, "auto");
  const link = await propertyLink(page, guide);

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  const dialog = guest.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Pregunta sobre Casa Colibrí" })).toBeVisible();
  await expect(dialog.getByText("En una emergencia, llama al 911.")).toBeVisible();
  await expect(dialog.getByText(/plataforma de tu reserva/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "¿Cómo entro?" })).toBeVisible();

  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  const answer = dialog.locator(".chat-msg-assistant").last();
  await expect(answer).toContainText("Abre la caja de llaves", { timeout: 15_000 });
  await expect(answer.getByRole("link", { name: "Llegada y acceso" })).toBeVisible();

  await sendChatMessage(guest, "¿Cuál es el código de la caja?");
  const pointer = dialog.locator(".chat-msg-assistant").last();
  await expect(pointer).toContainText("«Llegada y acceso»", { timeout: 15_000 });

  await sendChatMessage(guest, "Hola");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "Soy el asistente virtual de Casa Colibrí",
    { timeout: 15_000 },
  );
  expect(await guest.content()).not.toContain(LOCKBOX);

  // The conversation survives a reload (one conversation per device and property).
  await guest.reload();
  await openChat(guest);
  await expect(guest.getByRole("dialog").locator(".chat-msg-guest")).toHaveCount(3);
  await context.close();
});
