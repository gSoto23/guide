import { expect, test } from "@playwright/test";
import { openChat, propertyLink, publishGuide, sendChatMessage, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 005 US3 (quickstart scenario 3, T029): with the default autonomy "draft", the guest gets
 * a holding reply; the owner opens the conversation, sends the assistant's draft, then writes a
 * reply; the guest sees both, the draft as the assistant and the reply with the owner's name.
 */
test("quickstart 3: review drafts and reply", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("chat-us3"));
  const guide = await publishGuide(page);
  const link = await propertyLink(page, guide);

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  const dialog = guest.getByRole("dialog");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "Tu anfitrión lo revisará",
    { timeout: 15_000 },
  );

  await page.goto(`/es/properties/${guide.propertyId}`);
  await page.getByRole("link", { name: "Conversaciones" }).click();
  await expect(page.getByText("Motivo: Borrador listo para revisar")).toBeVisible();
  await page.getByRole("link", { name: "Abrir conversación" }).first().click();
  const draft = page.locator(".draft-card");
  await expect(draft.getByRole("heading", { name: "Borrador del asistente" })).toBeVisible();
  await expect(draft).toContainText("Abre la caja de llaves");
  await draft.getByText("Por qué esta respuesta").click();
  await expect(draft.getByText("Decisión: Preparó un borrador")).toBeVisible();
  await draft.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText("Respuesta enviada.")).toBeVisible();
  await expect(page.locator(".draft-card")).toHaveCount(0);

  await page.getByLabel("Tu respuesta").fill("¡Bienvenidos! Cualquier duda, aquí estoy.");
  await page.getByRole("button", { name: "Enviar respuesta" }).click();
  await expect(page.locator(".transcript-host").last()).toContainText("¡Bienvenidos!");

  // The chat refreshes within 5 seconds (FR-007).
  await expect(dialog.locator(".chat-msg-host").last()).toContainText("¡Bienvenidos!", {
    timeout: 15_000,
  });
  await expect(dialog.locator(".chat-msg-assistant").filter({ hasText: "Abre la caja de llaves" })).toBeVisible();
  await context.close();
});
