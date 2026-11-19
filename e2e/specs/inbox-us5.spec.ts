import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  signIn,
  uniqueEmail,
} from "../helpers/guest";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";
import { roomForTeam } from "../helpers/plan";

/**
 * Feature 006 US5 (T031): an agent typing a reply shows "{name} is replying" to the owner on the
 * conversation page. Fake model; fictional data.
 */
async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  return context.newPage();
}

test("quickstart 5: presence", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const agentEmail = uniqueEmail("inbox-us5-agent");
  await signIn(page, uniqueEmail("inbox-us5"));
  const guide = await publishGuide(page);

  // Free has one seat (feature 011): team tests get 10 seats as a custom limit.
  await roomForTeam(page);
  await page.goto("/es/settings/members");
  await page.getByLabel("Email", { exact: true }).fill(agentEmail);
  await page.getByRole("radio", { name: /Agente/ }).check();
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText(`Invitación enviada a ${agentEmail}`)).toBeVisible();
  const { text } = await latestMessageTo(agentEmail);
  const invitePath = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  const agent = await newPage(browser);
  await agent.goto(invitePath);
  await agent.getByRole("button", { name: "Continuar" }).click();
  await agent.getByLabel("Tu email").fill(agentEmail);
  await agent.getByRole("button", { name: "Enviarme un código" }).click();
  await waitForSubject(agentEmail, "Tu código de Guidesk");
  await agent.getByLabel("Código").fill(await latestCodeFor(agentEmail));
  await agent.getByRole("button", { name: "Entrar" }).click();
  await agent.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(agent.getByText(/Ya formas parte de/)).toBeVisible();

  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  await guest.goto(await propertyLink(page, guide));
  await openChat(guest);
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toBeVisible({
    timeout: 15_000,
  });

  await agent.goto("/es/inbox");
  await agent.locator(".inbox-item").first().getByRole("link").click();
  await agent.getByLabel("Tu respuesta").fill("Hola, ya te ayudo");
  await page.goto(agent.url().replace("http://localhost:3000", ""));
  await expect(page.getByText(/está respondiendo/)).toBeVisible({ timeout: 20_000 });
  await context.close();
});
