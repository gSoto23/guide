import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";

/** Quickstart V10, V11, and V12 (spec 001 US3, T070). */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  return context.newPage();
}

/** Signs in from the sign-in page with an email code; returns once the code is accepted. */
async function signInWithEmail(page: Page, email: string) {
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function inviteFromTeamPage(page: Page, email: string, role: "Agente" | "Administrador") {
  await page.goto("/es/settings/members");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("radio", { name: new RegExp(role) }).check();
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText(`Invitación enviada a ${email}`)).toBeVisible();
  const { text } = await latestMessageTo(email);
  const path = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0];
  expect(path, "invitation link in the email").toBeTruthy();
  return path ?? "";
}

test("V10 + V12: an agent joins from the invitation and cannot invite", async ({ browser }) => {
  const ownerEmail = uniqueEmail("owner");
  const agentEmail = uniqueEmail("agent");

  const owner = await newPage(browser);
  await owner.goto("/es/sign-in");
  await signInWithEmail(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/es\/onboarding/);
  const invitePath = await inviteFromTeamPage(owner, agentEmail, "Agente");

  // The invitee opens the link, signs up with the invited email, and comes back to accept.
  const agent = await newPage(browser);
  await agent.goto(invitePath);
  await expect(agent.getByRole("heading", { name: /Te invitaron a/ })).toBeVisible();
  await agent.getByRole("button", { name: "Continuar" }).click();
  await expect(agent).toHaveURL(/\/es\/sign-in/);
  await signInWithEmail(agent, agentEmail);
  await expect(agent).toHaveURL(new RegExp(invitePath));
  await agent.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(agent.getByText(/Ya formas parte de/)).toBeVisible();

  // The agent belongs only to the owner's workspace (no workspace of their own, FR-020).
  const me = (await (await agent.request.get("/api/v1/me")).json()) as {
    memberships: { role: string }[];
    lastWorkspaceId: string;
  };
  expect(me.memberships).toEqual([expect.objectContaining({ role: "agent" })]);

  // V12: agents can't manage the team.
  await agent.goto("/es/settings/members");
  await expect(agent.getByText("Solo el dueño y los administradores")).toBeVisible();
  const attempt = await agent.request.post(`/api/v1/workspaces/${me.lastWorkspaceId}/invitations`, {
    data: { email: uniqueEmail("nope"), role: "agent" },
  });
  expect(attempt.status()).toBe(403);

  // The owner hears that the agent joined (sent by the worker).
  expect(await waitForSubject(ownerEmail, "se unió")).toContain("se unió");
});

test("V11: an invitation opened with another email is refused", async ({ browser }) => {
  const owner = await newPage(browser);
  await owner.goto("/es/sign-in");
  await signInWithEmail(owner, uniqueEmail("owner-v11"));
  await expect(owner).toHaveURL(/\/es\/onboarding/);
  const invitePath = await inviteFromTeamPage(owner, uniqueEmail("invited-v11"), "Administrador");

  const stranger = await newPage(browser);
  await stranger.goto("/es/sign-in");
  await signInWithEmail(stranger, uniqueEmail("stranger-v11"));
  await expect(stranger).toHaveURL(/\/es\/onboarding/);
  await stranger.goto(invitePath);
  await stranger.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(stranger.getByText(/es para otra dirección de email/)).toBeVisible();
  await expect(stranger.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
});
