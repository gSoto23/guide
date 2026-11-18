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
 * Feature 006 US1 (quickstart 1, T011): two properties with drafts and an emergency; Needs you lists
 * the emergency first; the property filter; mark done and the guest's new message brings it back.
 * Fake model; fictional data.
 */
test("quickstart 1: one inbox", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail("inbox-us1"));
  const casa = await publishGuide(page, { name: "Casa Colibrí" });
  const villa = await publishGuide(page, { name: "Villa Mar" });

  const guestAt = async (guide: typeof casa, text: string) => {
    const context = await browser.newContext({
      locale: "es-CR",
      viewport: { width: 390, height: 844 },
    });
    const guest = await context.newPage();
    await guest.goto(await propertyLink(page, guide));
    await openChat(guest);
    await sendChatMessage(guest, text);
    await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toBeVisible({
      timeout: 15_000,
    });
    return { context, guest };
  };
  const casaGuest = await guestAt(casa, "¿Cómo abro la caja de llaves?");
  await guestAt(villa, "Hay humo en la cocina");

  await page.goto("/es/inbox");
  const items = page.locator(".inbox-item");
  await expect(items.first()).toContainText("Villa Mar");
  await expect(items.first()).toContainText("Posible emergencia");
  await expect(page.locator(".inbox-item", { hasText: "Casa Colibrí" })).toContainText(
    "Borrador listo para revisar",
  );

  await page.getByLabel("Propiedad").selectOption({ label: "Casa Colibrí" });
  await expect(page.locator(".inbox-item", { hasText: "Villa Mar" })).toHaveCount(0);

  await page.locator(".inbox-item", { hasText: "Casa Colibrí" }).getByRole("link").click();
  await page.getByRole("button", { name: "Marcar como lista" }).click();
  await expect(page.getByRole("button", { name: "Volver a abrir" })).toBeVisible();
  await page.goto("/es/inbox");
  await page.getByRole("tab", { name: "Listas" }).click();
  await expect(page.locator(".inbox-item", { hasText: "Casa Colibrí" })).toHaveCount(1);

  await sendChatMessage(casaGuest.guest, "Una pregunta más: ¿hay wifi?");
  await page.getByRole("tab", { name: "Todas" }).click();
  await expect(page.locator(".inbox-item", { hasText: "Casa Colibrí" })).toHaveCount(1, {
    timeout: 20_000,
  });
  await casaGuest.context.close();
});
