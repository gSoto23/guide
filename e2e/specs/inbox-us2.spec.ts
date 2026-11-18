import { expect, test } from "@playwright/test";
import {
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

/**
 * Feature 006 US2 (quickstart 2, T016): discard a draft (nothing reaches the guest), take over (no
 * assistant message, the reason banner), and hand back. Fake model; fictional data.
 */
test("quickstart 2: draft actions and take over", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("inbox-us2"));
  const guide = await publishGuide(page);
  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  await guest.goto(await propertyLink(page, guide));
  await openChat(guest);
  const dialog = guest.getByRole("dialog");
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "Tu anfitrión lo revisará",
    {
      timeout: 15_000,
    },
  );

  await page.goto("/es/inbox");
  await page.locator(".inbox-item").first().getByRole("link").click();
  await expect(page.getByText("Necesita a tu equipo: Borrador listo para revisar")).toBeVisible();
  await page.getByRole("button", { name: "Descartar borrador" }).click();
  await expect(page.getByText("Borrador descartado. El huésped no recibió nada.")).toBeVisible();
  await expect(dialog.locator(".chat-msg-assistant")).toHaveCount(1);

  await page.getByLabel("Responderé yo").check();
  await expect(page.getByText(/^La tomó /)).toBeVisible();
  await sendChatMessage(guest, "¿Me confirmas la hora de llegada?");
  await expect(
    page.getByText("Necesita a tu equipo: El huésped volvió a escribir (conversación tomada)"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".chat-msg-assistant")).toHaveCount(1);
  await expect(dialog.locator(".chat-typing")).toBeHidden();

  await page.getByLabel("Responderé yo").uncheck();
  await expect(page.getByText(/Mientras esté activo/)).toBeVisible();
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(dialog.locator(".chat-msg-assistant")).toHaveCount(2, { timeout: 15_000 });
  await context.close();
});
