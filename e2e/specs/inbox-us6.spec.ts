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
 * Feature 006 US6 (T034): five drafts on one topic sent unchanged produce the trust suggestion with
 * a link to the settings; dismissing hides it. Fake model; fictional data.
 */
test("quickstart 6: trust suggestion", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page, uniqueEmail("inbox-us6"));
  const guide = await publishGuide(page);
  const link = await propertyLink(page, guide);
  for (let index = 0; index < 5; index += 1) {
    const context = await browser.newContext({ locale: "es-CR" });
    const guest = await context.newPage();
    await guest.goto(link);
    await openChat(guest);
    await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
    await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toBeVisible({
      timeout: 15_000,
    });
    await context.close();
  }
  const list = await (await page.request.get(`${guide.base}/conversations`)).json();
  for (const conversation of list as { id: string }[]) {
    const detail = await (
      await page.request.get(`${guide.base}/conversations/${conversation.id}`)
    ).json();
    const sent = await page.request.post(
      `${guide.base}/conversations/${conversation.id}/drafts/${detail.draft.id}/send`,
      { data: {} },
    );
    expect(sent.ok()).toBe(true);
  }
  await page.goto("/es/inbox");
  const suggestion = page.locator(".suggestion");
  await expect(suggestion).toContainText("Ya enviaste 5 borradores sobre llegada y acceso");
  await expect(suggestion.getByRole("link", { name: "Revisar ajustes" })).toHaveAttribute(
    "href",
    "/es/settings/assistant",
  );
  await suggestion.getByRole("button", { name: "Ahora no" }).click();
  await expect(page.locator(".suggestion")).toHaveCount(0);
});
