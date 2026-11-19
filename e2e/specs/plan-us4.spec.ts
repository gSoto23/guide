import { expect, test } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";
import { setPlan, workspaceIdOf } from "../helpers/plan";

/**
 * Feature 011 US3 and US4 (quickstart 3 and 4, T019): the founder moves a Free workspace to Business
 * with the tool; Plan and limits shows the plan, unlimited properties and seats, the AI allowance
 * with its renewal, the workspace ID, and the security log shows the change by Guidesk; an agent
 * can't open the screen. Fictional data.
 */
test("quickstart 3 and 4: the founder's plan and the Plan and limits screen", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail("plan-us4"));
  await publishGuide(page);
  const workspaceId = await workspaceIdOf(page);

  await page.goto("/es/settings");
  await page.getByRole("link", { name: "Plan y límites" }).click();
  await expect(page.getByRole("heading", { name: "Plan y límites", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan Free" })).toBeVisible();
  await expect(page.locator(".bar-row").filter({ hasText: "Propiedades activas" })).toContainText(
    "1 de 2",
  );
  await expect(page.locator(".bar-row").filter({ hasText: "Asientos" })).toContainText("1 de 1");
  await expect(page.getByText(workspaceId)).toBeVisible();

  const output = setPlan(workspaceId, "business", { note: "e2e pilot partner" });
  expect(output).toContain("Plan changed from free to business.");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Plan Business" })).toBeVisible();
  await expect(page.locator(".bar-row").filter({ hasText: "Propiedades activas" })).toContainText(
    "1 · sin límite",
  );
  await expect(page.locator(".bar-row").filter({ hasText: "Respuestas de IA" })).toContainText(
    "0 de 300",
  );
  await expect(page.getByText(/300 por propiedad activa/)).toBeVisible();
  await expect(page.getByText(/Se renuevan el/)).toBeVisible();

  await page.goto("/es/settings/security-log");
  await expect(page.getByText("workspace.plan_changed")).toBeVisible();
  await expect(page.getByText(/· Guidesk/).first()).toBeVisible();

  // An agent joins (Business has room) and can't see the plan.
  const agentEmail = uniqueEmail("plan-us4-agent");
  await page.goto("/es/settings/members");
  await page.getByLabel("Email", { exact: true }).fill(agentEmail);
  await page.getByRole("radio", { name: /Agente/ }).check();
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText(/Invitación enviada/)).toBeVisible();
  const { text } = await latestMessageTo(agentEmail);
  const invitePath = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const agent = await context.newPage();
  await agent.goto(invitePath);
  await agent.getByRole("button", { name: "Continuar" }).click();
  await agent.getByLabel("Tu email").fill(agentEmail);
  await agent.getByRole("button", { name: "Enviarme un código" }).click();
  await waitForSubject(agentEmail, "Tu código de Guidesk");
  await agent.getByLabel("Código").fill(await latestCodeFor(agentEmail));
  await agent.getByRole("button", { name: "Entrar" }).click();
  await agent.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(agent.getByText(/Ya formas parte de/)).toBeVisible();
  await agent.goto("/es/settings/plan");
  await expect(
    agent.getByText("Solo el dueño y los administradores ven el plan del workspace."),
  ).toBeVisible();
  await expect(agent.locator(".plan-banner")).toHaveCount(0);
  await context.close();
});
