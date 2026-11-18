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
import { waitForSubject } from "../helpers/mailpit";

/**
 * Feature 005 US2 (quickstart scenario 2, T024): even with autonomy "auto", an emergency shows the
 * emergency card first and a holding reply, the conversation needs the host, and the team gets an
 * email. Fake model; fictional data.
 */
test("quickstart 2: hand risky messages to the host", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("chat-us2");
  await signIn(page, email);
  const guide = await publishGuide(page);
  await setAutonomy(page, guide, "auto");
  const link = await propertyLink(page, guide);

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  await sendChatMessage(guest, "Hay humo en la cocina");
  const dialog = guest.getByRole("dialog");
  const card = dialog.locator(".chat-emergency");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole("link", { name: "Llamar al 911" })).toHaveAttribute("href", "tel:911");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "Ya avisamos a tu anfitrión",
  );
  await waitForSubject(email, "Urgente: Un huésped de Casa Colibrí te necesita");

  await page.goto(`/es/properties/${guide.propertyId}/conversations`);
  await expect(page.getByText("Te necesita")).toBeVisible();
  await expect(page.getByText("Motivo: Posible emergencia")).toBeVisible();
  await context.close();
});
