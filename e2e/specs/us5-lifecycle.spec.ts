import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";

/** Quickstart V15, V16, and V17 (spec 001 US5, T091). */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  return page;
}

async function signIn(page: Page, email: string, from = "/es/sign-in") {
  if (from) await page.goto(from);
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("V15–V17: removal, the owner leaving, and deletion with restore", async ({ browser }) => {
  const ownerEmail = uniqueEmail("owner-v15");
  const agentEmail = uniqueEmail("agent-v15");
  const workspaceName = `Casa V17 ${Date.now().toString().slice(-6)}`;

  const owner = await newPage(browser);
  await signIn(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/es\/onboarding/);

  // Rename the workspace so it can be typed later.
  await owner.goto("/es/settings/workspace");
  await owner.getByLabel("Nombre", { exact: true }).fill(workspaceName);
  await owner.getByRole("button", { name: "Guardar" }).click();
  await expect(owner.getByText("Nombre guardado.")).toBeVisible();

  // Invite an agent, who joins from the link.
  await owner.goto("/es/settings/members");
  await owner.getByLabel("Email", { exact: true }).fill(agentEmail);
  await owner.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(owner.getByText(`Invitación enviada a ${agentEmail}`)).toBeVisible();
  const { text } = await latestMessageTo(agentEmail);
  const invitePath = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  const agent = await newPage(browser);
  await agent.goto(invitePath);
  await agent.getByRole("button", { name: "Continuar" }).click();
  await signIn(agent, agentEmail, "");
  await agent.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(agent.getByText(/Ya formas parte de/)).toBeVisible();
  const me = (await (await agent.request.get("/api/v1/me")).json()) as { lastWorkspaceId: string };

  // V15: the owner removes the agent, who loses access on the next request.
  await owner.reload();
  await owner.getByRole("button", { name: "Quitar" }).click();
  await expect(owner.getByText("ya no forma parte del workspace")).toBeVisible();
  expect((await agent.request.get(`/api/v1/workspaces/${me.lastWorkspaceId}`)).status()).toBe(404);
  await agent.goto("/es/settings/members");
  await expect(agent.getByTestId("current-workspace")).toHaveText("Sin workspace: crea uno");

  // V16: the owner can't leave before transferring ownership.
  await owner.goto("/es/settings/workspace");
  await expect(owner.getByText("Como dueño, primero transfiere la propiedad")).toBeVisible();
  await expect(owner.getByRole("button", { name: "Salir", exact: true })).toBeDisabled();
  const leave = await owner.request.post(`/api/v1/workspaces/${me.lastWorkspaceId}/leave`);
  expect(leave.status()).toBe(409);

  // V17: delete with the typed name, members are told, and the owner restores it.
  await owner.getByLabel("Nombre del workspace", { exact: true }).fill(workspaceName);
  await owner.getByRole("button", { name: "Eliminar workspace" }).click();
  await expect(owner.getByText(/El workspace se eliminará el/)).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Este workspace se va a eliminar" })).toBeVisible();
  expect(await waitForSubject(ownerEmail, "se eliminará")).toContain(workspaceName);
  await owner.getByRole("button", { name: "Restaurar workspace" }).click();
  await expect(owner.getByText("Workspace restaurado.")).toBeVisible();
});
