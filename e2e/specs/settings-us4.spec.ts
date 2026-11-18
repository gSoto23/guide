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
 * Feature 007 US4 (quickstart scenario 5, T032): the owner chooses the formal tone and the guest's
 * holding reply uses "usted"; instructions with a code are refused with the reason, and valid
 * instructions are saved. Fake model; fictional data.
 */
test("quickstart 5: tone and instructions", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("settings-us4"));
  const guide = await publishGuide(page);

  await page.goto("/es/settings/assistant");
  await page.getByRole("radio", { name: /^Formal \(usted\)/ }).check();
  const instructions = page.getByLabel("Instrucciones", { exact: true });
  await instructions.fill("Si preguntan, el código de la caja es 4821.");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Parecen tener un código o una contraseña.", { exact: false })).toBeVisible();
  await instructions.fill("Sugiere caminar a la playa; el parqueo allá es difícil.");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText("Ajustes guardados.")).toBeVisible();
  await expect(page.getByText(/^Actualizadas el/)).toBeVisible();

  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  await openChat(guest);
  await sendChatMessage(guest, "¿Cuál es la red del wifi?");
  await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toContainText(
    "Su anfitrión lo revisará y le responderá",
    { timeout: 15_000 },
  );
  await context.close();
});
