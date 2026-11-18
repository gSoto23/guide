import { expect, test } from "@playwright/test";
import {
  allTopics,
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  setAssistantSettings,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

/**
 * Feature 007 US2 (quickstart scenario 3, T021): with other questions at "answer and ask on its
 * own", an ambiguous question gets one clarifying question and a weather question a general
 * answer. Fake model; fictional data.
 */
test("quickstart 3: clarifying questions and general answers", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("settings-us2"));
  const guide = await publishGuide(page);
  await setAssistantSettings(page, guide, { autonomy: { ...allTopics("draft"), other: "full_auto" } });

  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  const dialog = guest.getByRole("dialog");
  await sendChatMessage(guest, "¿Está lejos?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText("¿Lejos de dónde", {
    timeout: 15_000,
  });
  await sendChatMessage(guest, "¿Cómo es el clima en marzo?");
  await expect(dialog.locator(".chat-msg-assistant").last()).toContainText(
    "Es información general",
    { timeout: 15_000 },
  );
  await context.close();
});
