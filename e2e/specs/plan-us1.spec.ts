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
import { setPlan, workspaceIdOf } from "../helpers/plan";

/**
 * Feature 011 US1 and US2 (quickstart 1 and 2, T019): with the month's AI replies used up, the guest
 * gets the holding reply, the inbox names the monthly limit, the copilot explains it, and owners see
 * the banner; on Free, a third property and any invitation are refused with a link to Plan and
 * limits. The threshold emails are covered by the worker tests. Fake model; fictional data.
 */
test("quickstart 1 and 2: AI replies, properties, and seats follow the plan", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail("plan-us1"));
  const casa = await publishGuide(page);
  await setAutonomy(page, casa, "auto");
  setPlan(await workspaceIdOf(page), "free", { aiReplies: 1, note: "e2e monthly limit" });

  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  await guest.goto(await propertyLink(page, casa));
  await openChat(guest);
  const replies = guest.getByRole("dialog").locator(".chat-msg-assistant");
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(replies.last()).toContainText("Abre la caja de llaves", { timeout: 15_000 });
  await sendChatMessage(guest, "¿Hay parqueo?");
  await expect(replies.last()).toContainText("Tu anfitrión te responderá aquí pronto", {
    timeout: 15_000,
  });
  await context.close();

  await page.goto("/es/inbox");
  await expect(page.getByText("Se acabaron las respuestas de IA del mes").first()).toBeVisible();
  const banner = page.locator(".plan-banner");
  await expect(banner).toContainText("Se acabaron las respuestas de IA de este mes.");

  await page.getByRole("link", { name: "Pegar un mensaje de un huésped" }).click();
  await page.getByLabel("Mensaje del huésped").fill("¿Cómo abro la caja de llaves?");
  await page.getByRole("radio", { name: "Reserva confirmada" }).check();
  await page.getByRole("button", { name: "Preparar respuesta" }).click();
  await expect(
    page.getByText(/Se acabaron las respuestas de IA de este mes; vuelven el/),
  ).toBeVisible({
    timeout: 20_000,
  });

  // Free: 2 properties and 1 seat (the owner).
  await publishGuide(page, { name: "Villa Mar" });
  await page.goto("/es/properties");
  await expect(page.getByText("2 de 2 propiedades")).toBeVisible();
  await expect(page.getByText("Llegaste al límite de 2 propiedades de tu plan.")).toBeVisible();
  await page.goto("/es/settings/members");
  await expect(page.getByText("1 de 1 asientos en uso")).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("plan-us1-agent"));
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText(/Ya usaste todos los asientos de tu plan/)).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Ver plan y límites" }).click();
  await expect(page.getByRole("heading", { name: "Plan y límites", level: 1 })).toBeVisible();
});
