import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US2 (quickstart 3, T064): locked fields are added with masked inputs, revealed for a
 * moment and logged, inserted into guide text as references, and a code typed as text is moved
 * into a locked field; the Wi-Fi password can be made public and locked again; an agent sees only
 * that fields exist. The reveal limit and the step-up window are covered by the API tests. All
 * codes are fictional.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  return context.newPage();
}

async function signInWithEmail(page: Page, email: string) {
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

const LOCKBOX = "7342";

test("quickstart 3: locked fields, references, code warnings, and the agent view", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await newPage(browser);
  owner.on("dialog", (dialog) => void dialog.accept());
  await owner.goto("/es/sign-in");
  await signInWithEmail(owner, uniqueEmail("guide-us2"));
  await expect(owner).toHaveURL(/\/es\/onboarding/);

  // A blank property; its guide starts empty.
  await owner.goto("/es/properties/new");
  await owner.getByRole("link", { name: /Empezar desde cero/ }).click();
  await owner.getByLabel(/^Nombre de la propiedad/).fill("Casa Tucán");
  await owner.getByLabel(/^País/).selectOption("CR");
  await owner.getByLabel(/^Calle y número/).fill("Calle Ficticia 456");
  await owner.getByLabel(/^Ciudad/).fill("Nosara");
  await owner.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(owner.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await owner.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(owner.getByRole("heading", { name: "Casa Tucán" })).toBeVisible();
  await owner.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(owner.getByRole("heading", { name: "Guía de Casa Tucán" })).toBeVisible();
  const guideUrl = owner.url();

  // Add a lockbox code with a masked input (FR-015, FR-016).
  await owner.getByRole("link", { name: /Campos protegidos/ }).click();
  await expect(owner.getByRole("heading", { name: "Campos protegidos" })).toBeVisible();
  await owner.getByRole("button", { name: "Agregar campo protegido" }).click();
  await owner.getByLabel("Tipo").selectOption("lockbox_code");
  await owner.getByLabel("Nombre").fill("Caja de llaves");
  await expect(owner.getByLabel("Valor")).toHaveAttribute("type", "password");
  await owner.getByLabel("Valor").fill(LOCKBOX);
  await owner.getByRole("button", { name: "Guardar" }).click();
  const lockbox = owner.getByRole("listitem").filter({ hasText: "Caja de llaves" });
  await expect(lockbox.getByText(/Configurado el/)).toBeVisible();
  await expect(owner.getByText(LOCKBOX)).toHaveCount(0);

  // Reveal it for a moment; the history lists who saw it (FR-016, FR-017).
  await lockbox.getByRole("button", { name: "Ver" }).click();
  await expect(lockbox.getByText(LOCKBOX)).toBeVisible();
  await expect(lockbox.getByText(/Se oculta en \d+ s/)).toBeVisible();
  await lockbox.getByRole("button", { name: "Ocultar" }).click();
  await expect(owner.getByText(LOCKBOX)).toHaveCount(0);
  await expect(owner.getByText(/vio «Caja de llaves»/)).toBeVisible();

  // The Wi-Fi password: public, then locked again (FR-021).
  await owner.getByRole("button", { name: "Agregar campo protegido" }).click();
  await owner.getByLabel("Tipo").selectOption("wifi_password");
  await owner.getByLabel("Valor").fill("palmera-azul");
  await owner.getByRole("button", { name: "Guardar" }).click();
  const wifi = owner.getByRole("listitem").filter({ hasText: "Contraseña de Wi-Fi" });
  await expect(wifi.getByText(/^Protegido ·/)).toBeVisible();
  // The switch follows the saved state, so it changes once the API answers.
  await wifi.getByLabel("Mostrar a cualquiera con el enlace de la guía").click();
  await expect(wifi.getByText(/^Pública ·/)).toBeVisible();
  await wifi.getByLabel("Mostrar a cualquiera con el enlace de la guía").click();
  await expect(wifi.getByText(/^Protegido ·/)).toBeVisible();

  // Insert the lockbox code into Arrival's text: the editor shows its label (FR-019).
  await owner.goto(guideUrl);
  await owner.getByRole("link", { name: "Llegada y acceso", exact: true }).click();
  await owner.getByRole("button", { name: "Agregar texto" }).click();
  const editor = owner.getByRole("textbox", { name: "Escribe para tus huéspedes…" });
  await editor.click();
  await editor.pressSequentially("La llave está en la caja: ");
  await owner.getByLabel("Insertar campo protegido").selectOption({ label: "Caja de llaves" });
  await expect(editor.locator(".locked-field-chip")).toHaveText("🔒 Caja de llaves");
  await expect(owner.getByText("Guardando…")).toHaveCount(0, { timeout: 10_000 });
  await owner.reload();
  await expect(owner.locator(".locked-field-chip")).toHaveText("🔒 Caja de llaves");

  // A code typed as text is caught and moved into a new locked field (FR-023).
  await owner.goto(guideUrl);
  await owner.getByRole("link", { name: "Normas de la casa", exact: true }).click();
  await owner.getByRole("button", { name: "Agregar texto" }).click();
  const rules = owner.getByRole("textbox", { name: "Escribe para tus huéspedes…" });
  await rules.click();
  await rules.pressSequentially("El código de la puerta es 4821");
  await expect(owner.getByText(/Esto parece un código/)).toBeVisible({ timeout: 10_000 });
  await owner.getByRole("button", { name: "Mover a un campo protegido" }).click();
  await expect(owner.getByText(/Esto parece un código/)).toHaveCount(0);
  await expect(owner.locator(".locked-field-chip")).toBeVisible();
  await owner.reload();
  await expect(owner.getByText("4821")).toHaveCount(0);

  // An agent sees only that the fields exist (FR-063, AC-SEC-001).
  await owner.goto("/es/settings/members");
  const agentEmail = uniqueEmail("guide-us2-agent");
  await owner.getByLabel("Email", { exact: true }).fill(agentEmail);
  await owner.getByRole("radio", { name: /Agente/ }).check();
  await owner.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(owner.getByText(`Invitación enviada a ${agentEmail}`)).toBeVisible();
  const invitePath = (await latestMessageTo(agentEmail)).text.match(
    /\/es\/invite\/[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(invitePath, "invitation link in the email").toBeTruthy();

  const agent = await newPage(browser);
  await agent.goto(invitePath ?? "");
  await agent.getByRole("button", { name: "Continuar" }).click();
  await signInWithEmail(agent, agentEmail);
  await agent.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(agent.getByText(/Ya formas parte de/)).toBeVisible();

  const lockedPath = new URL(guideUrl).pathname + "/locked-fields";
  await agent.goto(lockedPath);
  await expect(agent.getByText("Los campos protegidos solo los ven propietarios y administradores.")).toBeVisible();
  await expect(agent.getByRole("listitem").filter({ hasText: "Caja de llaves" })).toBeVisible();
  await expect(agent.getByRole("button", { name: "Ver" })).toHaveCount(0);
  await expect(agent.getByRole("button", { name: "Agregar campo protegido" })).toHaveCount(0);

  // A direct reveal is not found for agents; nothing about the value leaks.
  const me = (await (await agent.request.get("/api/v1/me")).json()) as { lastWorkspaceId: string };
  const propertyId = lockedPath.split("/")[3];
  const fields = (await (
    await agent.request.get(
      `/api/v1/workspaces/${me.lastWorkspaceId}/properties/${propertyId}/guide/locked-fields`,
    )
  ).json()) as { id: string }[];
  expect(JSON.stringify(fields)).not.toContain(LOCKBOX);
  const reveal = await agent.request.post(
    `/api/v1/workspaces/${me.lastWorkspaceId}/properties/${propertyId}/guide/locked-fields/${fields[0]?.id}/reveal`,
    { data: {} },
  );
  expect(reveal.status()).toBe(404);
});
