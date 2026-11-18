import { expect, test } from "@playwright/test";
import {
  assistantSettings,
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  setAssistantSettings,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Feature 007 US3 (quickstart scenario 4, T026): quiet hours covering now in the property's time
 * zone (Costa Rica, UTC−6) and one chosen contact. A non-urgent question gets a holding reply that
 * says when the host usually answers; an emergency still shows the card first. Fake model.
 */
test("quickstart 4: quiet hours and contacts", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("settings-us3"));
  const guide = await publishGuide(page);
  const hour = (new Date().getUTCHours() + 24 - 6) % 24;
  const start = `${pad((hour + 23) % 24)}:00`;
  const end = `${pad((hour + 2) % 24)}:00`;
  const owner = (await assistantSettings(page, guide)).members.find((m) => m.role === "owner")!;
  await setAssistantSettings(page, guide, {
    quietHours: { enabled: true, start, end },
    contacts: { mode: "selected", memberIds: [owner.id] },
  });

  await page.goto("/es/settings/assistant");
  await expect(page.getByLabel("Activar horas de silencio")).toBeChecked();
  await expect(page.getByLabel("Desde")).toHaveValue(start);
  await expect(page.getByRole("radio", { name: "Solo a estas personas" })).toBeChecked();

  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  const dialog = guest.getByRole("dialog");
  await sendChatMessage(guest, "¿Cuál es la red del wifi?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    `Tu anfitrión suele responder después de las ${end}.`,
    { timeout: 15_000 },
  );
  await sendChatMessage(guest, "Hay humo en la cocina");
  await expect(dialog.locator(".chat-emergency")).toBeVisible({ timeout: 15_000 });
  await context.close();
});
