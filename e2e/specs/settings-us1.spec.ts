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
 * Feature 007 US1 (quickstart scenarios 1 and 2, T015): the owner lets arrival questions answer on
 * their own and keeps Wi-Fi on drafts; the locked categories are listed; a guest gets an answer
 * for arrival and a holding reply for Wi-Fi. Fake model; fictional data.
 */
test("quickstart 1: autonomy per topic", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("settings-us1"));
  const guide = await publishGuide(page);

  await page.goto("/es/settings/assistant");
  await expect(page.getByRole("heading", { name: "Siempre pasan a tu equipo" })).toBeVisible();
  await expect(page.getByText("Emergencias y seguridad")).toBeVisible();
  await expect(page.getByText("Reembolsos, pagos y compensaciones")).toBeVisible();
  const levels = page.locator(".topic-rows");
  await levels.getByLabel("Llegada y acceso").selectOption("auto");
  await expect(levels.getByLabel("Wi-Fi")).toHaveValue("draft");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Ajustes guardados.")).toBeVisible();

  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  const dialog = guest.getByRole("dialog");
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText("Abre la caja de llaves", {
    timeout: 15_000,
  });
  await sendChatMessage(guest, "¿Cuál es la red del wifi?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "Tu anfitrión lo revisará",
    { timeout: 15_000 },
  );
  await context.close();

  // The property page shows what applies there and links to its own settings.
  await page.goto(`/es/properties/${guide.propertyId}`);
  const card = page.locator("section.card", { hasText: "Asistente del chat" });
  await expect(card.getByText("1 tema responde solo")).toBeVisible();
  await card.getByRole("link", { name: "Configurar el asistente" }).click();
  await expect(page.getByRole("heading", { name: "Asistente de esta propiedad" })).toBeVisible();
});
