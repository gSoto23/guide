import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";
import { roomForTeam } from "../helpers/plan";

/** Quickstart V13 (spec 001 US4, T081): switching in under 2 s, with no data mixing. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  return context.newPage();
}

async function signIn(page: Page, email: string) {
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/(onboarding|properties)/);
}

async function renameCurrentWorkspace(page: Page, name: string) {
  const me = (await (await page.request.get("/api/v1/me")).json()) as { lastWorkspaceId: string };
  const renamed = await page.request.patch(`/api/v1/workspaces/${me.lastWorkspaceId}`, {
    data: { name },
  });
  expect(renamed.status()).toBe(200);
}

test("V13: a co-host switches between workspaces in under 2 s, seeing only each one's data", async ({
  browser,
}) => {
  const marcoEmail = uniqueEmail("marco");
  const luisaEmail = uniqueEmail("luisa");
  const suffix = Date.now().toString().slice(-5);
  const marcoWorkspace = `Casa Marco ${suffix}`;
  const luisaWorkspace = `Depto Luisa ${suffix}`;

  // Luisa has her own workspace.
  const luisa = await newPage(browser);
  await signIn(luisa, luisaEmail);
  await renameCurrentWorkspace(luisa, luisaWorkspace);

  // Marco invites Luisa as an agent; she accepts while signed in.
  const marco = await newPage(browser);
  await signIn(marco, marcoEmail);
  await renameCurrentWorkspace(marco, marcoWorkspace);
  // Free has one seat (feature 011): team tests get 10 seats as a custom limit.
  await roomForTeam(marco);
  await marco.goto("/es/settings/members");
  await marco.getByLabel("Email", { exact: true }).fill(luisaEmail);
  await marco.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(marco.getByText(`Invitación enviada a ${luisaEmail}`)).toBeVisible();
  const { text } = await latestMessageTo(luisaEmail);
  const invitePath = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  await luisa.goto(invitePath);
  await luisa.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(luisa.getByText(/Ya formas parte de/)).toBeVisible();

  // In Marco's workspace she is an agent: the current workspace shows, and only agent actions.
  await luisa.goto("/es/settings/members");
  const current = luisa.getByTestId("current-workspace");
  await expect(current).toHaveText(marcoWorkspace);
  await expect(luisa.getByText("Solo el dueño y los administradores")).toBeVisible();

  // Two taps to switch to her own workspace, in under 2 s.
  const started = Date.now();
  await luisa.getByRole("button", { name: /Cambiar de workspace/ }).click();
  await luisa.getByRole("button", { name: new RegExp(luisaWorkspace) }).click();
  await expect(current).toHaveText(luisaWorkspace);
  await expect(luisa.getByRole("heading", { name: "Invitar a alguien" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000);

  // Her own team shows only her, never Marco (no data mixing).
  const members = luisa.getByRole("region", { name: "Miembros" });
  await expect(members).toContainText(luisaEmail);
  await expect(members).not.toContainText(marcoEmail);

  // The next sign-in reopens the workspace she used last (FR-024).
  const again = await newPage(browser);
  await signIn(again, luisaEmail);
  await again.goto("/es/settings/members");
  await expect(again.getByTestId("current-workspace")).toHaveText(luisaWorkspace);
});
